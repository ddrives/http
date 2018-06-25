var http = require('http')
var test = require('tape')
var memdb = require('memdb')
var ddatabase = require('@ddatabase/core')
var request = require('request')
var ddriveHttp = require('..')

var core = ddatabase(memdb())
var ddb1 = core.createDdb()
var ddb2 = core.createDdb()
var server = http.createServer()
var ddbs = {}
ddbs[ddb1.key.toString('hex')] = ddb1
ddbs[ddb2.key.toString('hex')] = ddb2

test('dDrive HTTP Tests: setup', function (t) {
  server.listen(8080)
  server.once('listening', function () {
    ddb1.append('hello', function () {
      ddb1.append('world', function () {
        t.end()
      })
    })
    var quote = {
      quote: 'Today you are you! That is truer than true! There is no one alive who is you-er than you!',
      source: 'Dr. Seuss'
    }
    ddb2.append(JSON.stringify(quote))
  })
})

test('dDrive HTTP Tests: Single Ddb Data', function (t) {
  var onrequest = ddriveHttp(ddb1)
  server.once('request', onrequest)
  request('http://localhost:8080', function (err, res, body) {
    t.error(err, 'no request error')
    if (!err && res.statusCode === 200) {
      t.ok(body, 'received data')
      body = body.trim().split('\n')
      t.same(body[0], '"hello"', 'first chunk correct')
      t.same(body[1], '"world"', 'second chunk correct')
      t.end()
    } else {
      t.fail('bad response')
      t.end()
    }
  })
})

test('dDrive HTTP Tests: Multiple Ddb Data', function (t) {
  var onrequest = ddriveHttp(getDdb)
  server.once('request', onrequest)
  request('http://localhost:8080/' + ddb1.key.toString('hex'), function (err, res, body) {
    t.error(err, 'no request error')
    if (!err && res.statusCode === 200) {
      t.ok(body, 'received data')
      body = body.trim().split('\n')
      t.same(body[0], '"hello"', 'first chunk correct')
      t.same(body[1], '"world"', 'second chunk correct')
      t.end()
    }
  })
})

test.onFinish(function () {
  server.close()
})

function getDdb (info, cb) {
  cb(null, ddbs[info.key])
}
