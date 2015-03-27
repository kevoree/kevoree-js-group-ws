// Created by leiko on 02/10/14 12:20
var Class = require('pseudoclass');
var WebSocket = require('ws');
var UUID = require('uuid');
var kevoree = require('kevoree-library').org.kevoree;
var KevScript = require('kevoree-kevscript');

var Protocol = require('./Protocol');
var PushMessage = require('./message/PushMessage');
var PullMessage = require('./message/PullMessage');

/**
 * Handles client events on the WebSocket server
 *  - connection
 *  - messages
 *  - disconnection
 * @type {ClientHandler}
 */
var ClientHandler = Class({
    toString: 'ClientHandler',

    construct: function (group) {
        this.group = group;
        // cache maps
        this.name2Ws = {};
        this.ws2Name = {};
        this.kevs = new KevScript();
    },

    tpl: function (nodeName) {
        return this.group.getDictionary()
            .getString('onConnect', '')
            .replace(/{nodeName}/g, nodeName)
            .replace(/{groupName}/g, this.group.getName());
    },

    /**
     * Returns a client handler for WebSocketServer
     * @returns {function(this:ClientHandler)}
     */
    getHandler: function () {
        return function (ws) {
            ws.id = UUID();

            // kevoree tools
            var factory = new kevoree.factory.DefaultKevoreeFactory(),
                loader  = factory.createJSONLoader(),
                saver   = factory.createJSONSerializer(),
                compare = factory.createModelCompare(),
                cloner  = factory.createModelCloner();

            // websocket listeners
            ws.on('close', function () {
                if (this.ws2Name[ws.id] !== null) {
                    delete this.name2Ws[this.ws2Name[ws.id]];
                }
                delete this.ws2Name[ws.id];
            }.bind(this));

            ws.on('error', function () {
                try {
                    ws.close();
                } catch (err) {
                    this.group.log.error(this.group.toString(), err.stack);
                }

                if (this.ws2Name !== null) {
                    if (this.ws2Name[ws.id] !== null) {
                        delete this.name2Ws[this.ws2Name[ws.id]];
                    }
                    delete this.ws2Name[ws.id];
                }
            }.bind(this));

            ws.on('message', function (msg) {
                var parsedMsg = Protocol.parse(msg);
                if (parsedMsg === null) {
                    this.group.log.error(this.group.toString(), '"'+this.group.getName()+'" unknown Kevoree message '+msg);
                } else {
                    switch (parsedMsg.getType()) {
                        case Protocol.REGISTER_TYPE:
                            if (!this.name2Ws[parsedMsg.getNodeName()]) {
                                // cache new client
                                this.name2Ws[parsedMsg.getNodeName()] = ws;
                                this.ws2Name[ws.id] = parsedMsg.getNodeName();

                                if (this.group.isMaster()) {
                                    this.group.log.info(this.group.toString(), 'New client registered "'+parsedMsg.getNodeName()+'"');
                                    var modelToApply = cloner.clone(this.group.getKevoreeCore().getCurrentModel());
                                    if (parsedMsg.getModel() || parsedMsg.getModel() !== 'null') {
                                        // new registered model has a model to share: merging it locally
                                        var recModel = loader.loadModelFromString(parsedMsg.getModel()).get(0);
                                        compare.merge(modelToApply, recModel).applyOn(modelToApply);
                                        this.group.log.info(this.group.toString(), 'Merging his model with mine');
                                    }

                                    // broadcast method
                                    var broadcastModel = function (model) {
                                        this.group.log.info(this.group.toString(), 'Broadcasting merged model to all connected clients');
                                        var pushMessage = new PushMessage(saver.serialize(model));
                                        for (var name in this.name2Ws) {
                                            if (this.name2Ws[name].readyState === WebSocket.OPEN) {
                                                this.name2Ws[name].send(pushMessage.toRaw());
                                            }
                                        }
                                        this.group.getKevoreeCore().deploy(model);
                                    }.bind(this);

                                    // add onConnect logic
                                    this.kevs.parse(this.tpl(parsedMsg.getNodeName()), modelToApply, function (err, model) {
                                        if (err) {
                                            this.log.error(this.toString(), 'Unable to parse onConnect KevScript. Broadcasting model without onConnect process.');
                                            broadcastModel(modelToApply);
                                        } else {
                                            broadcastModel(model);
                                        }
                                    }.bind(this));
                                }
                            }
                            break;

                        case Protocol.PULL_TYPE:
                            var modelReturn = saver.serialize(this.group.getKevoreeCore().getCurrentModel());
                            ws.send(modelReturn);
                            this.group.log.info(this.group.toString(), 'Pull requested');
                            break;

                        case Protocol.PUSH_TYPE:
                            var model = loader.loadModelFromString(parsedMsg.getModel()).get(0);
                            if (this.group.hasMaster()) {
                                if (this.group.isMaster()) {
                                    var count = 0;
                                    for (var clientName in this.name2Ws) {
                                        if (this.name2Ws.hasOwnProperty(clientName)) {
                                            count++;
                                            if (this.name2Ws[clientName].readyState === WebSocket.OPEN) {
                                                this.name2Ws[clientName].send(parsedMsg.toRaw());
                                            }
                                        }
                                    }
                                    if (count > 0) {
                                        this.group.log.info(this.group.toString(), 'Broadcast model over '+count+' client'+((count > 1) ? 's':''));
                                    }
                                }
                            } else {
                                // TODO ?
                                this.group.log.info(this.group.toString(), 'No master specified, model will NOT be send to all other nodes');
                            }

                            this.group.log.info(this.group.toString(), 'Push received, applying locally...');
                            this.group.getKevoreeCore().deploy(model);

                            break;

                        default:
                            this.group.log.error(this.group.toString(), '"'+this.group.getName()+'" unhandled Kevoree message ' + msg);
                            break;
                    }
                }
            }.bind(this));
        }.bind(this);
    },

    /**
     * Clear server caches
     */
    clearCache: function () {
        Object.keys(this.name2Ws).forEach(function (name) {
            delete this.name2Ws[name];
        }.bind(this));

        Object.keys(this.ws2Name).forEach(function (wsId) {
            delete this.ws2Name[wsId];
        }.bind(this));
    }
});

module.exports = ClientHandler;