'use strict';

/* global Headers */

const expect = require('chai').expect;

const serverless = require('../serverless-http');
const Request = require('../lib/request');

function captureRequest(event, options) {
  let captured;
  const handler = serverless((req, res) => {
    captured = req;
    res.end('');
  }, options);

  return handler(event, {}).then(() => captured);
}

// [name, value, name, value, ...] -> [[name, value], ...]
function pairs(rawHeaders) {
  const result = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    result.push([rawHeaders[i], rawHeaders[i + 1]]);
  }
  return result;
}

describe('rawHeaders', () => {
  it('should list api gateway v1 headers with their original casing', async () => {
    const req = await captureRequest({
      httpMethod: 'POST',
      path: '/mcp',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      multiValueHeaders: {
        'Content-Type': ['application/json'],
        'Accept': ['application/json, text/event-stream'],
      },
      requestContext: { requestId: 'abc' },
      body: '{}',
    });

    expect(pairs(req.rawHeaders)).to.eql([
      ['Content-Type', 'application/json'],
      ['Accept', 'application/json, text/event-stream'],
      ['x-request-id', 'abc'],
      ['content-length', '2'],
    ]);
  });

  it('should list http api v2 and function url headers', async () => {
    const req = await captureRequest({
      version: '2.0',
      rawPath: '/mcp',
      rawQueryString: '',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
        'host': 'abc.lambda-url.us-east-1.on.aws',
      },
      requestContext: {
        requestId: 'abc',
        http: { method: 'POST', path: '/mcp', sourceIp: '1.2.3.4' },
      },
      body: '{}',
      isBase64Encoded: false,
    });

    expect(pairs(req.rawHeaders)).to.eql([
      ['content-type', 'application/json'],
      ['accept', 'application/json, text/event-stream'],
      ['host', 'abc.lambda-url.us-east-1.on.aws'],
      ['x-request-id', 'abc'],
      ['content-length', '2'],
    ]);
  });

  it('should join the http api v2 cookies array into one cookie header', async () => {
    const req = await captureRequest({
      version: '2.0',
      rawPath: '/',
      rawQueryString: '',
      cookies: ['a=1', 'b=2'],
      headers: { 'accept': '*/*' },
      requestContext: { http: { method: 'GET', path: '/' } },
    }, { requestId: false });

    expect(pairs(req.rawHeaders)).to.eql([
      ['cookie', 'a=1; b=2'],
      ['accept', '*/*'],
      ['content-length', '0'],
    ]);
  });

  it('should repeat a header for each of its multiValueHeaders values (alb)', async () => {
    const req = await captureRequest({
      requestContext: { elb: { targetGroupArn: 'arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/tg/1' } },
      httpMethod: 'GET',
      path: '/',
      multiValueQueryStringParameters: {},
      multiValueHeaders: {
        'accept': ['text/html'],
        'x-forwarded-for': ['1.1.1.1', '2.2.2.2'],
      },
      body: '',
      isBase64Encoded: false,
    });

    expect(pairs(req.rawHeaders)).to.eql([
      ['accept', 'text/html'],
      ['x-forwarded-for', '1.1.1.1'],
      ['x-forwarded-for', '2.2.2.2'],
      ['content-length', '0'],
    ]);
    expect(req.headers['x-forwarded-for']).to.equal('1.1.1.1, 2.2.2.2');
  });

  it('should list a header whose name is also an Object.prototype property', async () => {
    const req = await captureRequest({
      version: '2.0',
      rawPath: '/',
      rawQueryString: '',
      headers: { 'constructor': 'x', 'accept': '*/*' },
      requestContext: { http: { method: 'GET', path: '/' } },
    }, { requestId: false });

    expect(pairs(req.rawHeaders)).to.eql([
      ['constructor', 'x'],
      ['accept', '*/*'],
      ['content-length', '0'],
    ]);
  });

  it('should agree with req.headers', async () => {
    const events = {
      'api gateway v1': {
        httpMethod: 'GET',
        path: '/',
        // From the AWS docs: headers holds the last value of a repeated header.
        headers: { 'Header1': 'value1', 'Header2': 'value2' },
        multiValueHeaders: { 'Header1': ['value1'], 'Header2': ['value1', 'value2'] },
        requestContext: { requestId: 'abc' },
      },
      'api gateway v2': {
        version: '2.0',
        rawPath: '/',
        rawQueryString: '',
        cookies: ['a=1', 'b=2'],
        headers: { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream' },
        requestContext: { requestId: 'abc', http: { method: 'POST', path: '/' } },
        body: '{}',
      },
      'alb': {
        requestContext: { elb: { targetGroupArn: 'arn' } },
        httpMethod: 'GET',
        path: '/',
        multiValueHeaders: { 'X-Forwarded-For': ['1.1.1.1', '2.2.2.2'], 'Accept': ['text/html'] },
      },
    };

    for (const name of Object.keys(events)) {
      const req = await captureRequest(events[name]);

      // Web-standard adapters (for example @hono/node-server) build their Headers from rawHeaders.
      const fromRaw = new Headers();
      pairs(req.rawHeaders).forEach(([key, value]) => fromRaw.append(key, value));

      const expected = Object.keys(req.headers).map(key => [key, String(req.headers[key])]);
      const actual = Object.keys(req.headers).map(key => [key, fromRaw.get(key)]);

      expect(actual, name).to.eql(expected);
      expect(req.rawHeaders.every(value => typeof value === 'string'), name).to.equal(true);
    }
  });

  it('should be derived from headers when no rawHeaders are given', () => {
    const req = new Request({
      method: 'GET',
      url: '/',
      headers: { 'accept': '*/*', 'set-cookie': ['a=1', 'b=2'], 'x-empty': undefined },
      body: Buffer.from('hi'),
    });

    expect(pairs(req.rawHeaders)).to.eql([
      ['accept', '*/*'],
      ['set-cookie', 'a=1'],
      ['set-cookie', 'b=2'],
      ['content-length', '2'],
    ]);
  });
});
