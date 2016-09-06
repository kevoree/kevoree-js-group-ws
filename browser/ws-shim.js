'use strict';

var util = require('util');

function WebSocketWrapper() {
  WebSocket.call(this, arguments);
}

util.inherits(WebSocketWrapper, WebSocket);

WebSocketWrapper.prototype.on = function (event, handler) {
  this['on' + event] = handler;
};
WebSocketWrapper.prototype.off = function (event, handler) {
  if (typeof handler === 'function') {
    if (this['on' + event] === handler) {
      delete this['on' + event];
    }
  }
};

function WebSocketServer() {
  throw new Error('WebSocketServer are not supported in browser environment.');
}

module.exports = WebSocketWrapper;
module.exports.WebSocketServer = WebSocketServer;