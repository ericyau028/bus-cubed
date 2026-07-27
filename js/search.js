document.addEventListener('DOMContentLoaded', function () {
  document.addEventListener('click', function (e) {
    document.querySelectorAll('.nav-more.open').forEach(function (el) {
      if (!el.contains(e.target)) el.classList.remove('open');
    });
  });
});

(function() {
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
    '航':'航','選':'选','單':'单','區':'区','評':'评','價':'价','訊':'讯',
    '驗':'验','報':'报','預':'预','溫':'温','度':'度','濕':'湿','紫':'紫',
    '外':'外','降':'降','雨':'雨','量':'量','級':'级'
  };

  var en2zh = {
    'tsim sha tsui':'尖沙咀','central':'中環','mong kok':'旺角',
    'causeway bay':'銅鑼灣','wan chai':'灣仔','jordan':'佐敦',
    'sham shui po':'深水埗','sha tin':'沙田','tuen mun':'屯門',
    'yuen long':'元朗','tai po':'大埔','fanling':'粉嶺',
    'sheung shui':'上水','kowloon':'九龍','hong kong':'香港',
    'admiralty':'金鐘','sai kung':'西貢','stanley':'赤柱',
    'shek o':'石澳','hung hom':'紅磡','kowloon bay':'九龍灣',
    'kwun tong':'觀塘','kwai chung':'葵涌','tsing yi':'青衣',
    'ma on shan':'馬鞍山','tai wai':'大圍','fo tan':'火炭',
    'science park':'科學園','cyberport':'數碼港','wong tai sin':'黃大仙',
    'diamond hill':'鑽石山','lok fu':'樂富','shek kip mei':'石硤尾',
    'prince edward':'太子','cheung sha wan':'長沙灣','lai chi kok':'荔枝角',
    'mei foo':'美孚','tung chung':'東涌','disneyland':'迪士尼',
    'airport':'機場','ocean park':'海洋公園','peak':'山頂',
    'the peak':'山頂','victoria harbour':'維多利亞港','happy valley':'跑馬地',
    'kennedy town':'堅尼地城','sai wan':'西環','tin hau':'天后',
    'fortress hill':'炮台山','north point':'北角','quarry bay':'鰂魚涌',
    'taikoo':'太古','sai wan ho':'西灣河','shau kei wan':'筲箕灣',
    'chai wan':'柴灣','lei yue mun':'鯉魚門','yau tong':'油塘',
    'lam tin':'藍田','ngau tau kok':'牛頭角','ngau chi wan':'牛池灣',
    'choi hung':'彩虹','kowloon tong':'九龍塘','lai king':'荔景',
    'kwai fong':'葵芳','kwai hing':'葵興','tai wo hau':'大窩口',
    'tsuen wan':'荃灣','sunny bay':'欣澳','siu hong':'兆康',
    'tin shui wai':'天水圍','long ping':'朗屏','kam sheung road':'錦上路',
    'tai po market':'大埔墟','tai wo':'太和','lo wu':'羅湖',
    'lok ma chau':'落馬洲','university':'大學','racecourse':'馬場',
    'city one':'第一城','siu lek yuen':'小瀝源','shek mun':'石門',
    'heng on':'恒安','tai shui hang':'大水坑','wu kai sha':'烏溪沙',
    'kowloon city':'九龍城','to kwa wan':'土瓜灣','ma tau wai':'馬頭圍',
    'ho man tin':'何文田','whampoa':'黃埔',
    'tai kok tsui':'大角咀','yau ma tei':'油麻地','stonecutters':'昂船洲',
    'ma wan':'馬灣','tai mo shan':'大帽山','lantau':'大嶼山',
    'chek lap kok':'赤鱲角','peng chau':'坪洲','cheung chau':'長洲',
    'lamma':'南丫島','po toi':'蒲台島','clearwater bay':'清水灣',
    'pak sha wan':'白沙灣'
  };

  function toTraditional(s) {
    var r = '';
    for (var i = 0; i < s.length; i++) r += s2t[s[i]] || s[i];
    return r;
  }

  function normalizeQuery(q) {
    q = q.trim().toLowerCase();
    var trad = toTraditional(q);
    if (en2zh[q]) return en2zh[q];
    for (var en in en2zh) {
      if (en.indexOf(q) !== -1 || q.indexOf(en) !== -1) return en2zh[en];
    }
    return trad;
  }

  function buildSearchText(item, fields) {
    var text = '';
    for (var i = 0; i < fields.length; i++) {
      var val = item[fields[i]];
      if (val) text += ' ' + String(val).toLowerCase();
    }
    var trad = toTraditional(text);
    if (trad !== text) text += ' ' + trad;
    return text;
  }

  window.normalizeSearch = normalizeQuery;

  window.createSearch = function(config) {
    var data = config.data || [];
    var fields = config.fields || ['n', 'a'];
    var container = typeof config.container === 'string' ? document.querySelector(config.container) : config.container;
    if (!container) return;
    var onFilter = config.onFilter || function(d) {};
    var placeholder = config.placeholder || '搜尋車站名稱、路線編號... (繁/簡/EN)';

    var wrapper = document.createElement('div');
    wrapper.className = 'search-bar';
    wrapper.innerHTML =
      '<div class="search-input-wrap">' +
        '<span class="search-icon">🔍</span>' +
        '<input type="text" class="search-input" placeholder="' + placeholder + '" autocomplete="off">' +
        '<button class="search-clear" style="display:none">✕</button>' +
      '</div>' +
      '<div class="search-count"></div>' +
      '<div class="search-hint">' + LANG.t('search_hint') + '</div>';

    container.appendChild(wrapper);

    var input = wrapper.querySelector('.search-input');
    var clearBtn = wrapper.querySelector('.search-clear');
    var countEl = wrapper.querySelector('.search-count');
    var hintEl = wrapper.querySelector('.search-hint');
    var timer = null;

    data.forEach(function(item) {
      item._searchText = buildSearchText(item, fields);
    });

    function doFilter() {
      var raw = input.value;
      var q = raw.trim().toLowerCase();
      clearBtn.style.display = raw ? '' : 'none';

      var filtered;
      if (!raw) {
        filtered = data;
      } else {
        var normQ = normalizeQuery(q);
        filtered = data.filter(function(item) {
          var st = item._searchText;
          if (st.indexOf(q) !== -1) return true;
          if (normQ && st.indexOf(normQ) !== -1) return true;
          return false;
        });
      }

      countEl.textContent = raw
        ? LANG.t('search_result', { n: filtered.length, total: data.length })
        : '';
      hintEl.style.display = raw ? 'none' : '';
      onFilter(filtered);
    }

    input.addEventListener('input', function() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(doFilter, 150);
    });

    input.addEventListener('focus', function() {
      hintEl.style.display = '';
    });

    clearBtn.addEventListener('click', function() {
      input.value = '';
      doFilter();
      input.focus();
    });

    document.addEventListener('langchange', function() {
      placeholder = LANG.t('search_placeholder');
      input.setAttribute('placeholder', placeholder);
      hintEl.textContent = LANG.t('search_hint');
      if (input.value) doFilter();
    });

    return {
      filter: doFilter,
      input: input,
      setData: function(newData) {
        data = newData;
        data.forEach(function(item) {
          item._searchText = buildSearchText(item, fields);
        });
      },
      destroy: function() { container.removeChild(wrapper); }
    };
  };
})();
