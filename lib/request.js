'use strict';

const http = require('http');
const { PassThrough } = require('stream');

// Node lists the header lines it received in rawHeaders as [name, value, name, value, ...],
// and some libraries read headers from there rather than from req.headers.
function rawHeadersFrom(headers) {
  return Object.keys(headers).reduce((rawHeaders, name) => {
    const values = Array.isArray(headers[name]) ? headers[name] : [headers[name]];
    values.forEach(value => {
      if (value != null) {
        rawHeaders.push(name, String(value));
      }
    });
    return rawHeaders;
  }, []);
}

module.exports = class ServerlessRequest extends http.IncomingMessage {
  constructor({ method, url, headers, rawHeaders = rawHeadersFrom(headers), body, remoteAddress }) {
    // Create a real readable socket for IncomingMessage instead of a stub.
    const socket = new PassThrough();
    socket.encrypted = true;
    socket.remoteAddress = remoteAddress;
    socket.address = () => ({ port: 443 });

    super(socket);

    if (typeof headers['content-length'] === 'undefined') {
      headers['content-length'] = Buffer.byteLength(body);
      rawHeaders.push('content-length', String(headers['content-length']));
    }

    Object.assign(this, {
      ip: remoteAddress,
      complete: true,
      httpVersion: '1.1',
      httpVersionMajor: '1',
      httpVersionMinor: '1',
      method,
      headers,
      rawHeaders,
      body,
      url,
    });

    // Make the request stream readable by pushing the body when consumed.
    this._read = () => {
      if (typeof body !== 'undefined' && body !== null) {
        this.push(body);
      }
      this.push(null);
    };

    // If there's no body, emit 'end' on next tick so on-finished(req) fires
    // even when no one consumes the stream.
    if (!body || Buffer.byteLength(body) === 0) {
      setImmediate(() => this.emit('end'));
    }
  }
};
