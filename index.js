var assert = require('assert')
var stream = require('stream')
var dWebChannel = require('@dwcore/channel')
var TimeoutStream = require('through-timeout')
var cbTimeout = require('callback-timeout')
var mime = require('mime')
var rangeParser = require('range-parser')
var ndjson = require('ndjson')
var dWebCodec = require('@dwebs/codec')
var dws2 = require('@dwcore/dws2')
var debug = require('debug')('dDriveHttp')

module.exports = function (getVault, opts) {
  assert.ok(getVault, 'dDriveHttp: getVault|vault required')

  var vault
  if (typeof (getVault) !== 'function') {
    // Make a getVault function to get the single vault by default
    vault = getVault
    getVault = function (datUrl, cb) {
      cb(null, vault)
    }
  }
  // Sanity check =)
  assert.equal(typeof getVault, 'function', 'dDriveHttp: getVault must be function')

  var that = onrequest
  that.parse = parse
  that.get = function (req, res, vault, opts) {
    if (vault) return serveDdbOrVault(req, res, vault)
    var datUrl = parse(req)
    getVault(datUrl, function (err, vault) {
      if (err) return onerror(err)
      serveDdbOrVault(req, res, vault, datUrl)
    })
  }
  that.file = function (req, res, vault, filename) {
    if (vault) return serveFile(req, res, vault, filename)
    var datUrl = parse(req)
    getVault(datUrl, function (err, vault) {
      if (err) return onerror(err)
      serveFile(req, res, vault, datUrl.filename)
    })
  }

  return that

  function onrequest (req, res) {
    var datUrl = parse(req)
    if (!datUrl) return onerror(404, res) // TODO: explain error in res

    getVault(datUrl, function (err, vault) {
      if (err) return onerror(err, res) // TODO: explain error in res
      if (!vault) return onerror(404, res) // TODO: explain error in res

      if (datUrl.op === 'upload') {
        var ws = vault.createFileWriteStream('file')
        ws.on('finish', () => res.end(dWebCodec.encode(vault.key)))
        dWebChannel(req, ws)
        return
      } else if (!datUrl.filename || !vault.metadata) {
        // serve vault or ddatabase ddb
        serveDdbOrVault(req, res, vault, datUrl).pipe(res)
      } else {
        serveFile(req, res, vault, datUrl.filename)
      }
    })
  }

  function parse (req) {
    var segs = req.url.split('/').filter(Boolean)
    var key = vault
      ? dWebCodec.encode(vault.key)
      : segs.shift()
    var filename = segs.join('/')
    var op = 'get'

    try {
      // check if we are serving vault at root
      key = key.replace(/\.changes$/, '')
      dWebCodec.decode(key)
    } catch (e) {
      filename = segs.length ? [key].concat(segs).join('/') : key
      key = null
    }

    if (/\.changes$/.test(req.url)) {
      op = 'changes'
      if (filename) filename = filename.replace(/\.changes$/, '')
    } else if (req.method === 'POST') {
      op = 'upload'
    }

    var results = {
      key: key,
      filename: filename,
      op: op
    }
    debug('parse() results', results)
    return results
  }
}

function serveDdbOrVault (req, res, vault, urlOpts) {
  debug('serveDdbOrVault', vault.key.toString('hex'))
  var opts = { live: urlOpts.op === 'changes' }
  var dWebStreams2 = new stream.PassThrough()
  var src = vault.metadata ? vault.list(opts) : vault.createReadStream(opts)
  var timeout = TimeoutStream({
    objectMode: true,
    duration: 10000
  }, () => {
    onerror(404, res)
    src.destroy()
  })

  res.setHeader('Content-Type', 'application/json')
  if (vault.metadata) return dWebChannel(src, timeout, ndjson.serialize(), through)
  return dWebChannel(src, timeout, dws2.obj(function (chunk, enc, cb) {
    cb(null, chunk.toString())
  }), ndjson.serialize(), through)
}

function serveFile (req, res, vault, filename) {
  debug('serveFile', vault.key.toString('hex'), 'filename', [filename])

  vault.get(filename, cbTimeout((err, entry) => {
    if (err && err.code === 'ETIMEDOUT') return onerror(404, res)
    if (err || !entry || entry.type !== 'file') return onerror(404, res)
    debug('serveFile, got entry', entry)

    var range = req.headers.range && rangeParser(entry.length, req.headers.range)[0]

    res.setHeader('Access-Ranges', 'bytes')
    res.setHeader('Content-Type', mime.lookup(filename))

    if (!range || range < 0) {
      res.setHeader('Content-Length', entry.length)
      if (req.method === 'HEAD') return res.end()
      debug('serveFile, returning file')
      return dWebChannel(vault.createFileReadStream(entry), res)
    } else {
      res.statusCode = 206
      res.setHeader('Content-Length', range.end - range.start + 1)
      res.setHeader('Content-Range', 'bytes ' + range.start + '-' + range.end + '/' + entry.length)
      if (req.method === 'HEAD') return res.end()
      return dWebChannel(vault.createFileReadStream(entry, {start: range.start, end: range.end + 1}), res)
    }
  }, 10000))
}

function onerror (status, res) {
  if (typeof status !== 'number') status = 404
  res.statusCode = status
  res.end()
}
