/* plan.js - 路線規劃：直達 / 1 次轉乘 / 2 次轉乘 */
(function() {
  'use strict';

  var routesData = null;
  var routeList = [];       // [{route,bound,orig_tc,dest_tc,stops}]
  var stopNameMap = {};     // stop_id -> name_tc
  var routeByStop = {};     // stop_id -> [routeIndex...]

  function loadData(cb) {
    if (routesData) { cb(); return; }
    Promise.all([
      fetch('data/bus-routes-index.json').then(function(r) { return r.json(); }),
      fetch('data/bus-stops-index.json').then(function(r) { return r.json(); })
    ]).then(function(results) {
      routesData = results[0];
      var stopsObj = results[1];
      // Build stop name map
      for (var id in stopsObj) {
        stopNameMap[id] = stopsObj[id].name_tc || '';
      }
      // Build route list + index by stop
      routeList = [];
      routeByStop = {};
      routesData.forEach(function(r, ri) {
        if (!r.stops || r.stops.length === 0) return;
        var idx = routeList.length;
        routeList.push({ route: r.route, bound: r.bound, orig_tc: r.orig_tc, dest_tc: r.dest_tc, stops: r.stops });
        r.stops.forEach(function(s) {
          var sid = String(s.stop_id);
          if (!routeByStop[sid]) routeByStop[sid] = [];
          routeByStop[sid].push(idx);
        });
      });
      cb();
    });
  }

  function stopName(sid) {
    return stopNameMap[sid] || '站';
  }

  // Find routes that pass through a stop_id
  function routesThrough(sid) {
    return routeByStop[String(sid)] || [];
  }

  // Direct: one route passes both stops, and from -> to is in order
  function findDirect(fromSid, toSid) {
    var results = [];
    routesThrough(fromSid).forEach(function(ri) {
      var r = routeList[ri];
      var fromIdx = -1, toIdx = -1;
      r.stops.forEach(function(s, i) {
        if (String(s.stop_id) === String(fromSid)) fromIdx = i;
        if (String(s.stop_id) === String(toSid)) toIdx = i;
      });
      if (fromIdx !== -1 && toIdx !== -1 && fromIdx < toIdx) {
        results.push({ legs: [
          { route: r.route, bound: r.bound, fromName: stopName(fromSid), toName: stopName(toSid), fromIdx: fromIdx + 1, toIdx: toIdx + 1 }
        ], transfers: 0 });
      }
    });
    return results.slice(0, 3);
  }

  // One transfer: A through fromSid, B through toSid, A & B share a stop
  function findOneTransfer(fromSid, toSid) {
    var results = [];
    var fromRoutes = routesThrough(fromSid);
    var toRoutes = routesThrough(toSid);
    var seen = {};

    fromRoutes.forEach(function(ai) {
      var a = routeList[ai];
      var aFromIdx = -1;
      a.stops.forEach(function(s, i) { if (String(s.stop_id) === String(fromSid)) aFromIdx = i; });
      if (aFromIdx === -1) return;

      // stops after the boarding stop on route A
      for (var j = aFromIdx + 1; j < a.stops.length; j++) {
        var transferStop = String(a.stops[j].stop_id);
        toRoutes.forEach(function(bi) {
          var b = routeList[bi];
          // skip same physical route (different bound or same)
          if (b.route === a.route) return;
          var bTransferIdx = -1, bToIdx = -1;
          b.stops.forEach(function(s, i) {
            if (String(s.stop_id) === transferStop) bTransferIdx = i;
            if (String(s.stop_id) === String(toSid)) bToIdx = i;
          });
          if (bTransferIdx !== -1 && bToIdx !== -1 && bTransferIdx < bToIdx) {
            var key = a.route + '|' + a.bound + '|' + b.route + '|' + b.bound + '|' + transferStop;
            if (seen[key]) return;
            seen[key] = true;
            results.push({ legs: [
              { route: a.route, bound: a.bound, fromName: stopName(fromSid), toName: stopName(transferStop), fromIdx: aFromIdx + 1, toIdx: j + 1 },
              { route: b.route, bound: b.bound, fromName: stopName(transferStop), toName: stopName(toSid), fromIdx: bTransferIdx + 1, toIdx: bToIdx + 1 }
            ], transfers: 1 });
          }
        });
      }
    });
    // sort: prefer fewer transfer stop variety
    return results.slice(0, 3);
  }

  // Two transfers: A from -> x, B x -> y, C y -> to
  function findTwoTransfer(fromSid, toSid) {
    var results = [];
    var fromRoutes = routesThrough(fromSid);
    var toRoutes = routesThrough(toSid);
    var seen = {};

    // Build candidate transfer pairs: first transfer stop X (from A), then Y (shared B&C)
    fromRoutes.forEach(function(ai) {
      var a = routeList[ai];
      var aFromIdx = -1;
      a.stops.forEach(function(s, i) { if (String(s.stop_id) === String(fromSid)) aFromIdx = i; });
      if (aFromIdx === -1) return;

      for (var xj = aFromIdx + 1; xj < a.stops.length; xj++) {
        var xSid = String(a.stops[xj].stop_id);
        var routesThroughX = routesThrough(xSid);
        if (routesThroughX.length === 0) continue;

        routesThroughX.forEach(function(bi) {
          if (bi === ai) return;
          var b = routeList[bi];
          if (b.route === a.route) return;
          var bXIdx = -1;
          b.stops.forEach(function(s, i) { if (String(s.stop_id) === xSid) bXIdx = i; });
          if (bXIdx === -1) return;

          for (var yk = bXIdx + 1; yk < b.stops.length; yk++) {
            var ySid = String(b.stops[yk].stop_id);
            toRoutes.forEach(function(ci) {
              if (ci === bi) return;
              var c = routeList[ci];
              if (c.route === b.route || c.route === a.route) return;
              var cYIdx = -1, cToIdx = -1;
              c.stops.forEach(function(s, i) {
                if (String(s.stop_id) === ySid) cYIdx = i;
                if (String(s.stop_id) === String(toSid)) cToIdx = i;
              });
              if (cYIdx !== -1 && cToIdx !== -1 && cYIdx < cToIdx) {
                var key = a.route + '|' + a.bound + '|' + b.route + '|' + b.bound + '|' + c.route + '|' + c.bound + '|' + xSid + '|' + ySid;
                if (seen[key]) return;
                seen[key] = true;
                results.push({ legs: [
                  { route: a.route, bound: a.bound, fromName: stopName(fromSid), toName: stopName(xSid), fromIdx: aFromIdx + 1, toIdx: xj + 1 },
                  { route: b.route, bound: b.bound, fromName: stopName(xSid), toName: stopName(ySid), fromIdx: bXIdx + 1, toIdx: yk + 1 },
                  { route: c.route, bound: c.bound, fromName: stopName(ySid), toName: stopName(toSid), fromIdx: cYIdx + 1, toIdx: cToIdx + 1 }
                ], transfers: 2 });
              }
            });
          }
        });
      }
    });
    return results.slice(0, 3);
  }

  function plan(fromSid, toSid) {
    if (String(fromSid) === String(toSid)) return { error: 'same' };
    var direct = findDirect(fromSid, toSid);
    if (direct.length > 0) return { plans: direct };
    var one = findOneTransfer(fromSid, toSid);
    if (one.length > 0) return { plans: one };
    var two = findTwoTransfer(fromSid, toSid);
    if (two.length > 0) return { plans: two };
    return { plans: [] };
  }

  window.PLAN = {
    loadData: loadData,
    stopName: stopName,
    plan: plan,
    routeList: routeList,
  };
})();
