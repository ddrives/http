var toHTML = require('directory-index-html')
var pump = require('pump')
var mime = require('mime')
var range = require('range-parser')
var qs = require('querystring')
var corsify = require('corsify')
var pkg = require('./package.json')

module.exports = serve

function serve (vault, opts) {
  if (!opts) opts = {}

  return corsify(onrequest)

  function onrequest (req, res) {
    var name = decodeURI(req.url.split('?')[0])
    var query = qs.parse(req.url.split('?')[1] || '')

    var wait = (query.wait && Number(query.wait.toString())) || 0
    var have = vault.metadata ? vault.metadata.length : -1

    if (wait <= have) return ready()
    waitFor(vault, wait, ready)

    function ready () {
      var arch = /^\d+$/.test(query.version) ? vault.checkout(Number(query.version)) : vault
      if (name[name.length - 1] === '/') ondirectory(arch, name, req, res, opts)
      else onfile(arch, name, req, res)
    }
  }
}

function onfile (vault, name, req, res) {
  vault.stat(name, function (err, st) {
    if (err) return on404(vault, res, req)

    if (st.isDirectory()) {
      res.statusCode = 302
      res.setHeader('Location', name + '/')
      return
    }

    var r = req.headers.range && range(st.size, req.headers.range)[0]
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Type', mime.lookup(name))

    if (r) {
      res.statusCode = 206
      res.setHeader('Content-Range', 'bytes ' + r.start + '-' + r.end + '/' + st.size)
      res.setHeader('Content-Length', r.end - r.start + 1)
    } else {
      res.setHeader('Content-Length', st.size)
    }

    if (req.method === 'HEAD') return res.end()
    pump(vault.createReadStream(name, r), res)
  })
}

function on404 (vault, req, res) {
  getManifest(vault, function (err, parsed) {
    if (err) return onerror(res, 404, err)

    var fallbackPage = parsed.fallback_page

    if (!fallbackPage) return onerror(res, 404, new Error('Not Found, No Fallback'))

    vault.stat(fallbackPage, function (err) {
      if (err) return onerror(res, 404, err)
      onfile(vault, fallbackPage, req, res)
    })
  })
}

function ondirectory (vault, name, req, res, opts) {
  vault.stat(name + 'index.html', function (err) {
    if (err) return ondirectoryindex(vault, name, req, res, opts)
    onfile(vault, name + 'index.html', req, res)
  })
}

function ondirectoryindex (vault, name, req, res, opts) {
  list(vault, name, function (err, entries) {
    if (err) entries = []

    var wait = vault.metadata ? vault.metadata.length + 1 : 0
    var script = `
      function liveUpdate () {
        var xhr = new XMLHttpRequest()
        xhr.open("GET", ".${name}?wait=${wait}", true)
        xhr.onload = function () {
          if (xhr.status !== 200) return onerror()
          document.open()
          document.write(xhr.responseText)
          document.close()
        }
        xhr.onerror = onerror
        xhr.send(null)
        function onerror () {
          setTimeout(liveUpdate, 1000)
        }
      }
      liveUpdate()
    `

    var footer = opts.footer ? 'Vault version: ' + vault.version : null
    var html = toHTML({directory: name, script: (!opts.live || vault._checkout) ? null : script, footer: footer}, entries)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Content-Length', Buffer.byteLength(html))
    if (opts.exposeHeaders) {
      res.setHeader('dDrive-Key', vault.key.toString('hex'))
      res.setHeader('dDrive-Version', vault.version)
      res.setHeader('dDrive-Http-Version', pkg.version)
    }
    res.end(html)
  })
}

function getManifest (vault, cb) {
  vault.readFile('/dpack.json', 'utf-8', function (err, data) {
    if (err) cb(err)
    try {
      var parsed = JSON.parse(data)
    } catch (e) {
      return cb(err)
    }

    if (!parsed || Array.isArray(parsed) || (typeof parsed !== 'object')) {
      return cb(new Error('Invalid dpack.json format'))
    }

    cb(null, parsed)
  })
}

function waitFor (vault, until, cb) { // this feels a bit hacky, TODO: make less complicated?
  vault.setMaxListeners(0)
  if (!vault.metadata) vault.once('ready', waitFor.bind(null, vault, until, cb))
  if (vault.metadata.length >= until) return cb()
  vault.metadata.setMaxListeners(0)
  vault.metadata.once('append', waitFor.bind(null, vault, until, cb))
}

function onerror (res, status, err) {
  res.statusCode = status
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.end(err.stack)
}

function list (vault, name, cb) {
  vault.readdir(name, function (err, names) {
    if (err) return cb(err)

    var error = null
    var missing = names.length
    var entries = []

    if (!missing) return cb(null, [])
    for (var i = 0; i < names.length; i++) stat(name + names[i], names[i])

    function stat (name, base) {
      vault.stat(name, function (err, st) {
        if (err) error = err

        if (st) {
          entries.push({
            type: st.isDirectory() ? 'directory' : 'file',
            name: base,
            size: st.size,
            mtime: st.mtime
          })
        }

        if (--missing) return
        if (error) return cb(error)
        cb(null, entries.sort(sort))
      })
    }
  })
}

function sort (a, b) {
  return a.name.localeCompare(b.name)
}
