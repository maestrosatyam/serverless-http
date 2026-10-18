'use strict';

const URL = require('url');

const Request = require('../../request');

function requestMethod(event) {
  if (event.version === '2.0') {
    return event.requestContext.http.method;
  }
  return event.httpMethod;
}

function requestRemoteAddress(event) {
  if (event.version === '2.0') {
    return event.requestContext.http.sourceIp;
  }
  return event.requestContext.identity.sourceIp;
}

function requestHeaders(event) {
  const initialHeader =
    event.version === '2.0' && Array.isArray(event.cookies)
      ? { cookie: event.cookies.join('; ') }
      : {};

  if (event.multiValueHeaders) {
    Object.keys(event.multiValueHeaders).reduce((headers, key) => {
      headers[key.toLowerCase()] = event.multiValueHeaders[key].join(', ');
      return headers;
    }, initialHeader);
  }

  return Object.keys(event.headers).reduce((headers, key) => {
    headers[key.toLowerCase()] = event.headers[key];
    return headers;
  }, initialHeader);
}

// Header names keep the casing they have in the event, and a header with several
// multiValueHeaders values is listed once per value. REST API events also carry the last
// value of a repeated header in event.headers, which is what req.headers ends up with;
// rawHeaders follows req.headers in that case so the two never disagree.
function requestRawHeaders(event, headers) {
  // No prototype, so a header called "constructor" doesn't find Object's.
  const names = Object.create(null);
  const multiValues = Object.create(null);

  Object.keys(event.multiValueHeaders || {}).forEach(name => {
    names[name.toLowerCase()] = name;
    multiValues[name.toLowerCase()] = event.multiValueHeaders[name];
  });
  Object.keys(event.headers).forEach(name => {
    names[name.toLowerCase()] = name;
  });

  return Object.keys(headers).reduce((rawHeaders, key) => {
    const value = headers[key];
    const multiValue = multiValues[key];
    const values = multiValue && multiValue.join(', ') === value ? multiValue : [value];
    values.forEach(item => {
      if (item != null) {
        rawHeaders.push(names[key] || key, String(item));
      }
    });
    return rawHeaders;
  }, []);
}

function requestBody(event) {
  const type = typeof event.body;

  if (Buffer.isBuffer(event.body)) {
    return event.body;
  } else if (type === 'string') {
    return Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
  } else if (type === 'object') {
    return Buffer.from(JSON.stringify(event.body));
  }

  throw new Error(`Unexpected event.body type: ${typeof event.body}`);
}

function requestUrl(event) {
  if (event.version === '2.0') {
    return URL.format({
      pathname: event.rawPath,
      search: event.rawQueryString,
    });
  }
  // Normalize all query params into a single query string.
  const query = event.multiValueQueryStringParameters || {};
  if (event.queryStringParameters) {
    Object.keys(event.queryStringParameters).forEach((key) => {
      if (Array.isArray(query[key])) {
        if (!query[key].includes(event.queryStringParameters[key])) {
          query[key].push(event.queryStringParameters[key]);
        }
      } else {
        query[key] = [event.queryStringParameters[key]];
      }
    });
  }
  return URL.format({
    pathname: event.path,
    query: query,
  });
}

module.exports = (event, context, options) => {
  const method = requestMethod(event);
  const remoteAddress = requestRemoteAddress(event);
  const headers = requestHeaders(event);
  const body = requestBody(event);
  const url = requestUrl(event);

  if (typeof options.requestId === 'string' && options.requestId.length > 0) {
    const header = options.requestId.toLowerCase();
    const requestId = headers[header] || event.requestContext.requestId;
    if (requestId) {
      headers[header] = requestId;
    }
  }

  const req = new Request({
    method,
    headers,
    rawHeaders: requestRawHeaders(event, headers),
    body,
    remoteAddress,
    url,
  });

  req.requestContext = event.requestContext;
  req.apiGateway = {
    event,
    context,
  };

  return req;
};
