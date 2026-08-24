(function() {
  'use strict';

  var s2t = {
    '湾':'灣','区':'區','门':'門','东':'東','龙':'龍','广':'廣','场':'場',
    '点':'點','处':'處','务':'務','电':'電','话':'話','邮':'郵','车':'車',
    '长':'長','关':'關','医':'醫','药':'藥','疗':'療','诊':'診','专':'專',
    '儿':'兒','妇':'婦','产':'產','杂':'雜','项':'項','显':'顯','视':'視',
    '频':'頻','书':'書','馆':'館','图':'圖','园':'園','乐':'樂','动':'動',
    '态':'態','应':'應','数':'數','据':'據','铁':'鐵','线':'線','号':'號',
    '层':'層','厦':'廈','铺':'鋪','银':'銀','厅':'廳','组':'組','织':'織',
    '联':'聯','合':'合','会':'會','协':'協','员':'員','办':'辦','体':'體',
    '育':'育','剧':'劇','览':'覽','纪':'紀','念':'念','码':'碼','头':'頭',
    '轮':'輪','风':'風','湿':'濕','滩':'灘','泳':'泳','池':'池','运':'運',
    '总':'總','传':'傳','真':'真','网':'網','址':'址','箱':'箱','系':'係',
    '营':'營','业':'業','时':'時','间':'間','开':'開','放':'放','交':'交',
    '通':'通','具':'具','缆':'纜','顶':'頂','坪':'坪','迪':'迪','士':'士',
    '尼':'尼','题':'題','歷':'歷','史':'史','化':'化','政':'政','卫':'衛',
    '生':'生','费':'費','婴':'嬰','室':'室','餵':'喂','哺':'哺','换':'換',
    '更':'更','衣':'衣','灑':'洒','熱':'热','饮':'飲','售':'售','賣':'卖',
    '機':'机','款':'款','櫃':'柜','單':'单','約':'约','離':'离','導':'导',
    '航':'航','選':'选','區':'区','評':'评','價':'价','訊':'讯',
    '驗':'验','報':'报','預':'预','溫':'温','度':'度','濕':'湿','紫':'紫',
    '外':'外','降':'降','雨':'雨','量':'量','級':'级'
  };

  function toTraditional(s) {
    var r = '';
    for (var i = 0; i < s.length; i++) r += s2t[s[i]] || s[i];
    return r;
  }

  function normalize(s) {
    return toTraditional(s.trim().toLowerCase());
  }

  function stripCode(name) {
    return name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  }

  function matchScore(query, stopName) {
    var q = normalize(query);
    var full = normalize(stopName);
    var stripped = normalize(stripCode(stopName));
    if (full === q || stripped === q) return 100;
    if (full.indexOf(q) !== -1 || stripped.indexOf(q) !== -1) return 90;
    if (q.indexOf(full) !== -1 || q.indexOf(stripped) !== -1) return 80;
    return 0;
  }

  function findStops(query, stopsData) {
    var results = [];
    for (var id in stopsData) {
      var s = stopsData[id];
      var score = matchScore(query, s.name_tc || '');
      if (score > 0) {
        results.push({ id: id, name_tc: s.name_tc, name_en: s.name_en, score: score, routes: s.routes || [], lat: parseFloat(s.lat), lng: parseFloat(s.lng) });
      }
    }
    results.sort(function(a, b) { return b.score - a.score; });
    return results;
  }

  function findMTRStations(query, mtrData) {
    var results = [];
    var stations = mtrData.stations || [];
    var q = normalize(query);
    for (var i = 0; i < stations.length; i++) {
      var s = stations[i];
      var name = normalize(s.n || s.name_tc || '');
      if (name === q || name.indexOf(q) !== -1 || q.indexOf(name) !== -1) {
        results.push({ name: s.n, lat: s.lat, lng: s.lng, lines: s.l });
      }
    }
    return results;
  }

  function haversine(lat1, lng1, lat2, lng2) {
    var R = 6371000;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  function buildGraph(routesData, stopsData, mtrData) {
    var adj = {};
    var nodeInfo = {};

    // 1. Bus edges (variant-aware)
    routesData.forEach(function(r, idx) {
      var stops = r.stops || [];
      var prevGroup = [];
      var curGroup = [];
      var curNames = [];
      var lastSeq = null;
      var prevNames = [];

      for (var i = 0; i < stops.length; i++) {
        var seq = parseInt(stops[i].seq);
        if (seq !== lastSeq) {
          if (prevGroup.length > 0 && curGroup.length > 0) {
            var minLen = Math.min(prevGroup.length, curGroup.length);
            for (var p = 0; p < minLen; p++) {
              if (!adj[prevGroup[p]]) adj[prevGroup[p]] = [];
              adj[prevGroup[p]].push({
                to: curGroup[p], type: 'bus', route: r.route, bound: r.bound,
                routeIdx: idx, fromName: prevNames[p], toName: curNames[p]
              });
            }
          }
          prevGroup = curGroup.length > 0 ? curGroup : prevGroup;
          prevNames = curGroup.length > 0 ? curNames : prevNames;
          curGroup = [];
          curNames = [];
          lastSeq = seq;
        }
        curGroup.push(stops[i].stop_id);
        curNames.push(stops[i].name_tc);
      }
      if (prevGroup.length > 0 && curGroup.length > 0) {
        var ml = Math.min(prevGroup.length, curGroup.length);
        for (var p2 = 0; p2 < ml; p2++) {
          if (!adj[prevGroup[p2]]) adj[prevGroup[p2]] = [];
          adj[prevGroup[p2]].push({
            to: curGroup[p2], type: 'bus', route: r.route, bound: r.bound,
            routeIdx: idx, fromName: prevNames[p2], toName: curNames[p2]
          });
        }
      }
    });

    // 2. Stop proximity merging: connect stops within 100m (variant stops for same location)
    // Group by name prefix first for efficiency
    var stopIds = Object.keys(stopsData);
    var nameGroups = {};
    for (var i = 0; i < stopIds.length; i++) {
      var name = stripCode(stopsData[stopIds[i]].name_tc || '');
      var key = name.substring(0, 3);
      if (!nameGroups[key]) nameGroups[key] = [];
      nameGroups[key].push(stopIds[i]);
    }
    for (var key in nameGroups) {
      var group = nameGroups[key];
      for (var i = 0; i < group.length; i++) {
        var a = stopsData[group[i]];
        var aLat = parseFloat(a.lat), aLng = parseFloat(a.lng);
        if (!aLat || !aLng) continue;
        for (var j = i + 1; j < group.length; j++) {
          var b = stopsData[group[j]];
          var bLat = parseFloat(b.lat), bLng = parseFloat(b.lng);
          if (!bLat || !bLng) continue;
          var dist = haversine(aLat, aLng, bLat, bLng);
          if (dist <= 100) {
            if (!adj[group[i]]) adj[group[i]] = [];
            if (!adj[group[j]]) adj[group[j]] = [];
            adj[group[i]].push({ to: group[j], type: 'walk', fromName: a.name_tc, toName: b.name_tc, dist: Math.round(dist) });
            adj[group[j]].push({ to: group[i], type: 'walk', fromName: b.name_tc, toName: a.name_tc, dist: Math.round(dist) });
          }
        }
      }
    }

    // 3. MTR edges
    var mtrEdges = mtrData.edges || [];
    for (var i = 0; i < mtrEdges.length; i++) {
      var e = mtrEdges[i];
      var fromId = 'mtr_' + e.from;
      var toId = 'mtr_' + e.to;
      if (!adj[fromId]) adj[fromId] = [];
      if (!adj[toId]) adj[toId] = [];
      adj[fromId].push({ to: toId, type: 'mtr', line: e.line, fromName: e.from, toName: e.to });
      adj[toId].push({ to: fromId, type: 'mtr', line: e.line, fromName: e.to, toName: e.from });
    }

    // 4. Transfer edges: bus stop <-> nearby MTR station (within 600m)
    var mtrStations = mtrData.stations || [];
    for (var sid in stopsData) {
      var bs = stopsData[sid];
      var bsLat = parseFloat(bs.lat);
      var bsLng = parseFloat(bs.lng);
      if (!bsLat || !bsLng) continue;

      for (var j = 0; j < mtrStations.length; j++) {
        var ms = mtrStations[j];
        var dist = haversine(bsLat, bsLng, ms.lat, ms.lng);
        if (dist <= 600) {
          var mtrId = 'mtr_' + ms.n;
          if (!adj[sid]) adj[sid] = [];
          if (!adj[mtrId]) adj[mtrId] = [];
          adj[sid].push({ to: mtrId, type: 'transfer', fromName: bs.name_tc, toName: ms.n, dist: Math.round(dist) });
          adj[mtrId].push({ to: sid, type: 'transfer', fromName: ms.n, toName: bs.name_tc, dist: Math.round(dist) });
        }
      }
    }

    return { adj: adj };
  }

  function findAllRoutes(startIds, endIds, graph) {
    var results = [];
    var seen = {};
    var endSet = {};
    endIds.forEach(function(id) { endSet[id] = true; });

    // Direct bus routes
    startIds.forEach(function(startId) {
      var edges = graph.adj[startId] || [];
      edges.forEach(function(edge) {
        if (edge.type !== 'bus') return;
        var routeKey = startId + '_' + edge.routeIdx;
        if (seen[routeKey]) return;
        seen[routeKey] = true;
        var cur = startId;
        var pathEdges = [];
        var passedStart = false;
        for (var depth = 0; depth < 50; depth++) {
          var nextEdges = graph.adj[cur] || [];
          var nextEdge = null;
          for (var i = 0; i < nextEdges.length; i++) {
            if (nextEdges[i].type === 'bus' && nextEdges[i].routeIdx === edge.routeIdx) {
              nextEdge = nextEdges[i];
              break;
            }
          }
          if (!nextEdge) break;
          if (cur === startId || passedStart) {
            passedStart = true;
            pathEdges.push({ from: cur, to: nextEdge.to, type: 'bus', route: edge.route, bound: edge.bound, routeIdx: edge.routeIdx, fromName: nextEdge.fromName, toName: nextEdge.toName });
            if (endSet[nextEdge.to]) {
              var dk = startId + '_' + nextEdge.to + '_' + edge.routeIdx;
              if (!seen[dk]) { seen[dk] = true; results.push({ path: pathEdges, transfers: 0 }); }
              break;
            }
          }
          cur = nextEdge.to;
        }
      });
    });

    // Multi-modal routes (bus + transfer + MTR, or bus + transfer + bus)
    var visited = {};
    startIds.forEach(function(id) { visited[id] = true; });
    var queue = startIds.map(function(id) { return { stopId: id, path: [], routesUsed: {} }; });
    var depth = 0;
    while (queue.length > 0 && depth < 25 && results.length < 12) {
      var next = [];
      queue.forEach(function(state) {
        var edges = graph.adj[state.stopId] || [];
        edges.forEach(function(edge) {
          if (visited[edge.to]) return;
          var newPath = state.path.concat([edge]);
          var newRoutes = {};
          for (var k in state.routesUsed) newRoutes[k] = state.routesUsed[k];
          if (edge.type === 'bus') newRoutes['bus_' + edge.route] = true;
          else if (edge.type === 'mtr') newRoutes['mtr_' + edge.line] = true;
          else if (edge.type === 'transfer') newRoutes['transfer'] = true;

          if (endSet[edge.to]) {
            results.push({ path: newPath, transfers: Object.keys(newRoutes).length });
            return;
          }
          if (results.length < 15) {
            visited[edge.to] = true;
            next.push({ stopId: edge.to, path: newPath, routesUsed: newRoutes });
          }
        });
      });
      queue = next;
      depth++;
    }

    results.sort(function(a, b) {
      var aBus = 0, bBus = 0, aMTR = 0, bMTR = 0;
      a.path.forEach(function(e) { if (e.type === 'bus') aBus++; if (e.type === 'mtr') aMTR++; });
      b.path.forEach(function(e) { if (e.type === 'bus') bBus++; if (e.type === 'mtr') bMTR++; });
      if (aMTR === 0 && bMTR > 0) return -1;
      if (bMTR === 0 && aMTR > 0) return 1;
      return a.path.length - b.path.length;
    });

    // Deduplicate: group by bus routes used + MTR lines used
    var seen = {};
    var deduped = [];
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var keys = [];
      r.path.forEach(function(e) {
        if (e.type === 'bus') keys.push('B' + e.route);
        else if (e.type === 'mtr') keys.push('M' + e.line);
      });
      var key = keys.sort().join('+');
      if (!seen[key]) {
        seen[key] = true;
        deduped.push(r);
      }
    }
    return deduped.slice(0, 8);
  }

  function formatResult(result) {
    var segments = [];
    var curSeg = null;
    result.path.forEach(function(edge) {
      var segKey = edge.type + '_' + (edge.route || edge.line || '');
      if (!curSeg || curSeg.key !== segKey) {
        if (curSeg) segments.push(curSeg);
        curSeg = { type: edge.type, route: edge.route || edge.line, bound: edge.bound, key: segKey, stops: [] };
      }
      if (curSeg.stops.length === 0) curSeg.stops.push({ name: edge.fromName || '' });
      curSeg.stops.push({ name: edge.toName || '' });
    });
    if (curSeg) segments.push(curSeg);
    return { segments: segments, totalStops: result.path.length, transfers: result.transfers };
  }

  window.RoutePlanner = {
    findStops: findStops,
    findMTRStations: findMTRStations,
    buildGraph: buildGraph,
    findAllRoutes: findAllRoutes,
    formatResult: formatResult,
    stripCode: stripCode,
    toTraditional: toTraditional,
    haversine: haversine
  };
})();
