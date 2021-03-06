var http = require('http')
var fs = require('fs')
var path = require('path')
var test = require('tape')
var memdb = require('memdb')
var ddrive = require('@ddrive/core')
var request = require('request')
var raf = require('random-access-file')
var ndjson = require('ndjson')
var ddriveHttp = require('..')
var collect = require('collect-stream')
var encoding = require('@dwebs/codec')

var drive = ddrive(memdb())
var vault1 = drive.createVault({
  file: function (name) {
    return raf(path.join(__dirname, name))
  }
})
var vault2 = drive.createVault({
  file: function (name) {
    return raf(path.join(__dirname, name))
  }
})
var vault3 = drive.createVault()
var vault4 = drive.createVault()
var server = http.createServer()
var vaults = {}
vaults[vault1.key.toString('hex')] = vault1
vaults[vault2.key.toString('hex')] = vault2
vaults[vault3.key.toString('hex')] = vault3
vaults[vault4.key.toString('hex')] = vault4

test('setup', function (t) {
  server.listen(8000)
  server.once('listening', function () {
    vault1.append('feed.js', function () {
      vault1.append('drive.js', function () {
        vault2.append('drive.js', function () {
          vault4.append('dpack.json', function () {
            vault4.append('404.html', function () {
              t.end()
            })
          })
        })
      })
    })
  })
})

test('Single Vault Metadata', function (t) {
  var onrequest = ddriveHttp(vault1)
  server.once('request', onrequest)
  request('http://localhost:8000', function (err, res, body) {
    t.error(err, 'no request error')
    if (!err && res.statusCode === 200) {
      var data = body.trim().split('\n')
      t.same(data.length, 2, 'Two files in metadata')
      t.same(JSON.parse(data[0]).name, 'feed.js', 'File name correct')
      t.same(res.headers['content-type'], 'application/json', 'JSON content-type header')
      t.end()
    }
  })
})

test('Single Vault GET File', function (t) {
  var onrequest = ddriveHttp(vault1)
  server.once('request', onrequest)
  request('http://localhost:8000/drive.js', function (err, res, body) {
    t.error(err, 'no request error')
    if (!err && res.statusCode === 200) {
      t.ok(body, 'Responds with file')
      fs.stat(path.join(__dirname, 'drive.js'), function (_, stat) {
        t.same(stat.size, body.length, 'File size correct')
        t.same(res.headers['content-type'], 'application/javascript', 'JS content-type header')
        t.end()
      })
    }
  })
})

test('Single Vault POST File', function (t) {
  var onrequest = ddriveHttp(vault3)
  server.once('request', onrequest)
  fs.createReadStream(path.join(__dirname, 'drive.js'))
    .pipe(request.post('http://localhost:8000', function (err, res, body) {
      t.error(err, 'no request error')
      if (!err && res.statusCode === 200) {
        t.equal(body.toString(), encoding.encode(vault3.key), 'Responds with key')
        collect(vault3.createFileReadStream('file'), function (err, body) {
          t.error(err, 'no ddrive error')
          t.same(body, fs.readFileSync(path.join(__dirname, 'drive.js')))
          t.end()
        })
      }
    }))
})

test('Single Vault Metadata Changes', function (t) {
  t.plan(4)
  var count = 0
  var onrequest = ddriveHttp(vault1)
  server.once('request', onrequest)
  request('http://localhost:8000/.changes')
    .on('response', function (res) {
      if (!res.statusCode) t.notOk('request failed')
      var timeoutInt = setInterval(function () {
        if (count === 2) {
          clearInterval(timeoutInt)
          res.socket.end()
        }
      }, 100)
      t.pass('receives response')
      t.same(res.headers['content-type'], 'application/json', 'JSON content-type header')
    })
    .pipe(ndjson.parse())
    .on('data', function (obj) {
      count++
      t.ok(obj, 'received file data')
    })
    .on('end', function () {
      if (count < 2) t.fail('response should not end early')
    })
})

test('Multiple Vaults Metadata', function (t) {
  var onrequest = ddriveHttp(getVault)
  server.once('request', onrequest)
  var reqUrl = 'http://localhost:8000/' + vault2.key.toString('hex')
  request(reqUrl, function (err, res, body) {
    t.error(err, 'no request error')
    if (!err && res.statusCode === 200) {
      var data = body.trim().split('\n')
      t.same(data.length, 1, 'One file in metadata')
      t.same(JSON.parse(data[0]).name, 'drive.js', 'File name correct')
      t.same(res.headers['content-type'], 'application/json', 'JSON content-type header')
      t.end()
    }
  })
})

test('Multiple Vaults GET File', function (t) {
  var onrequest = ddriveHttp(getVault)
  server.once('request', onrequest)
  var reqUrl = 'http://localhost:8000/' + vault2.key.toString('hex') + '/drive.js'
  request(reqUrl, function (err, res, body) {
    t.error(err, 'no request error')
    if (!err && res.statusCode === 200) {
      t.ok(body, 'Responds with file')
      fs.stat(path.join(__dirname, 'drive.js'), function (_, stat) {
        t.same(stat.size, body.length, 'File size correct')
        t.same(res.headers['content-type'], 'application/javascript', 'JS content-type header')
        t.end()
      })
    }
  })
})

test('Multiple Vault POST File', function (t) {
  var onrequest = ddriveHttp(getVault)
  server.once('request', onrequest)
  fs.createReadStream(path.join(__dirname, 'drive.js'))
    .pipe(request.post('http://localhost:8000/', function (err, res, body) {
      t.error(err, 'no request error')
      if (!err && res.statusCode === 200) {
        t.equal(body.toString(), encoding.encode(vault3.key), 'Responds with key')
        collect(vault3.createFileReadStream('file'), function (err, body) {
          t.error(err, 'no ddrive error')
          t.same(body, fs.readFileSync(path.join(__dirname, 'drive.js')))
          t.end()
        })
      }
    }))
})

test('Multiple Vault POST File 2', function (t) {
  var onrequest = ddriveHttp(getVault)
  server.once('request', onrequest)
  var reqUrl = 'http://localhost:8000/' + vault3.key.toString('hex')
  fs.createReadStream(path.join(__dirname, 'drive.js'))
    .pipe(request.post(reqUrl, function (err, res, body) {
      t.error(err, 'no request error')
      if (!err && res.statusCode === 200) {
        t.equal(body.toString(), encoding.encode(vault3.key), 'Responds with key')
        collect(vault3.createFileReadStream('file'), function (err, body) {
          t.error(err, 'no ddrive error')
          t.same(body, fs.readFileSync(path.join(__dirname, 'drive.js')))
          t.end()
        })
      }
    }))
})

test('Multiple Vault Metadata Changes', function (t) {
  t.plan(4)
  var count = 0
  var onrequest = ddriveHttp(vault1)
  server.once('request', onrequest)
  request('http://localhost:8000/.changes')
    .on('response', function (res) {
      if (!res.statusCode) t.notOk('request failed')
      var timeoutInt = setInterval(function () {
        if (count === 2) {
          clearInterval(timeoutInt)
          res.socket.end()
        }
      }, 100)
      t.pass('receives response')
      t.same(res.headers['content-type'], 'application/json', 'JSON content-type header')
    })
    .pipe(ndjson.parse())
    .on('data', function (obj) {
      count++
      t.ok(obj, 'received file data')
    })
    .on('end', function () {
      if (count < 2) t.fail('response should not end early')
    })
})

test('Single vault fallback_page Support', function (t) {
  var onrequest = ddriveHttp(vault4)
  server.once('request', onrequest)
  request('http://localhost:8000/fakepage.html', function (err, res, body) {
    t.error(err, 'no request error')
    if (!err && res.statusCode === 200) {
      t.same(body, 'File Not Found Page', '404 page content')
      t.end()
    }
  })
})

test.onFinish(function () {
  server.close()
})

function getVault (info, cb) {
  cb(null, vaults[info.key] || vault3)
}
