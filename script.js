/**
 * ============================================
 * 个人机会雷达 - 前端逻辑 (ES5 兼容版)
 * 适配飞书/微信内置 WebView、安卓手机浏览器
 * ============================================
 */

(function () {
  'use strict';

  // ---- 常量配置 ----
  var CATEGORIES = [
    { name: '全部', icon: '🎯' },
    { name: '宏观政策风向', icon: '🏛️' },
    { name: '产业科技趋势', icon: '🔬' },
    { name: '商业创业机会', icon: '💼' },
    { name: '投资理财参考', icon: '📈' },
    { name: '社会民生变化', icon: '🏠' }
  ];

  var DATE_LABELS = { 0: '今天', 1: '昨天', 2: '前天' };

  // ---- 状态管理 ----
  var state = {
    newsData: null,
    availableDates: [],
    selectedDate: null,
    selectedCategory: '全部',
    theme: 'dark',
    expandedCards: {},
    voice: {
      isPlaying: false,
      isPaused: false,
      currentIndex: 0,
      playlist: [],
      isBatchMode: false,
      utterance: null,
      rate: 1.0,
      selectedVoice: null,
      voices: []
    }
  };

  // ---- 工具函数 ----
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  // 兼容 Object.keys
  var objectKeys = Object.keys || function (obj) {
    var keys = [];
    for (var k in obj) { if (obj.hasOwnProperty(k)) keys.push(k); }
    return keys;
  };

  // 兼容 Array.isArray
  var isArray = Array.isArray || function (arr) {
    return Object.prototype.toString.call(arr) === '[object Array]';
  };

  // 兼容 Array.prototype.forEach
  if (!Array.prototype.forEach) {
    Array.prototype.forEach = function (fn) {
      for (var i = 0; i < this.length; i++) fn(this[i], i, this);
    };
  }

  // 兼容 Array.prototype.filter
  if (!Array.prototype.filter) {
    Array.prototype.filter = function (fn) {
      var res = [];
      for (var i = 0; i < this.length; i++) { if (fn(this[i], i, this)) res.push(this[i]); }
      return res;
    };
  }

  // 兼容 Array.prototype.map
  if (!Array.prototype.map) {
    Array.prototype.map = function (fn) {
      var res = [];
      for (var i = 0; i < this.length; i++) res.push(fn(this[i], i, this));
      return res;
    };
  }

  // 兼容 Array.prototype.findIndex
  if (!Array.prototype.findIndex) {
    Array.prototype.findIndex = function (fn) {
      for (var i = 0; i < this.length; i++) { if (fn(this[i], i, this)) return i; }
      return -1;
    };
  }

  // 兼容 Array.prototype.find
  if (!Array.prototype.find) {
    Array.prototype.find = function (fn) {
      for (var i = 0; i < this.length; i++) { if (fn(this[i], i, this)) return this[i]; }
      return undefined;
    };
  }

  // 兼容 Array.prototype.some
  if (!Array.prototype.some) {
    Array.prototype.some = function (fn) {
      for (var i = 0; i < this.length; i++) { if (fn(this[i], i, this)) return true; }
      return false;
    };
  }

  // 兼容 String.prototype.includes
  if (!String.prototype.includes) {
    String.prototype.includes = function (search) {
      return this.indexOf(search) !== -1;
    };
  }

  // 兼容 String.prototype.startsWith
  if (!String.prototype.startsWith) {
    String.prototype.startsWith = function (search) {
      return this.indexOf(search) === 0;
    };
  }

  // 兼容 Set
  var SimpleSet = function () {
    this._items = {};
  };
  SimpleSet.prototype.has = function (key) { return !!this._items[key]; };
  SimpleSet.prototype.add = function (key) { this._items[key] = true; };
  SimpleSet.prototype.delete = function (key) { delete this._items[key]; };
  SimpleSet.prototype.clear = function () { this._items = {}; };
  state.expandedCards = new SimpleSet();

  // ---- DOM 元素引用 ----
  var DOM = {
    navDate: $('#navDate'),
    themeToggle: $('#themeToggle'),
    dateSelector: $('#dateSelector'),
    categoryTabs: $('#categoryTabs'),
    statsText: $('#statsText'),
    batchPlayBtn: $('#batchPlayBtn'),
    batchPlayIcon: $('#batchPlayIcon'),
    batchPlayText: $('#batchPlayText'),
    newsGrid: $('#newsGrid'),
    loadingState: $('#loadingState'),
    errorState: $('#errorState'),
    errorMessage: $('#errorMessage'),
    retryBtn: $('#retryBtn'),
    emptyState: $('#emptyState'),
    voiceControlBar: $('#voiceControlBar'),
    voiceTitle: $('#voiceTitle'),
    voiceStatus: $('#voiceStatus'),
    vcPlayPause: $('#vcPlayPause'),
    vcStop: $('#vcStop'),
    vcPrev: $('#vcPrev'),
    vcNext: $('#vcNext'),
    speedSlider: $('#speedSlider'),
    speedLabel: $('#speedLabel'),
    voiceSelect: $('#voiceSelect')
  };

  // ---- 初始化 ----
  function init() {
    initTheme();
    initSpeechVoices();
    bindEvents();
    loadNewsData();
  }

  // ---- 主题管理 ----
  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem('news-theme'); } catch (e) {}
    if (saved) {
      state.theme = saved;
    } else {
      try {
        state.theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      } catch (e) {
        state.theme = 'dark';
      }
    }
    applyTheme();
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.content = state.theme === 'dark' ? '#0a0e1a' : '#f5f7fb';
    }
  }

  function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('news-theme', state.theme); } catch (e) {}
    applyTheme();
  }

  // ---- 语音初始化 ----
  var voicesLoaded = false;

  // 语音名称映射表：技术名称 → 通俗易懂的中文名称
  var VOICE_NAME_MAP = {
    // 微软在线语音（自然）
    'xiaoxiao': '晓晓（女声·自然）',
    'yunxi': '云希（男声·自然）',
    'yunjian': '云健（男声·沉稳）',
    'yunxia': '云夏（女声·温柔）',
    'yunyang': '云扬（男声·专业）',
    'xiaoyi': '晓伊（女声·活泼）',
    'xiaobei': '晓北（女声·东北）',
    'xiaoni': '晓妮（女声·陕西）',
    // 台湾语音
    'hsiaochen': '晓臻（女声·台湾）',
    'hsiaoyu': '晓雨（女声·台湾）',
    'yunjhe': '云哲（男声·台湾）',
    // 香港语音
    'hiugaai': '晓佳（女声·粤语）',
    'hiumaan': '晓曼（女声·粤语）',
    'wanlung': '云龙（男声·粤语）',
    // 本地语音
    'huihui': '慧慧（女声·本地）',
    'kangkang': '康康（男声·本地）',
    'yaoyao': '瑶瑶（女声·本地）'
  };

  // 获取友好的语音名称
  function getFriendlyVoiceName(voice) {
    var name = voice.name.toLowerCase();
    // 尝试匹配映射表
    for (var key in VOICE_NAME_MAP) {
      if (name.indexOf(key) !== -1) {
        return VOICE_NAME_MAP[key];
      }
    }
    // 未匹配时，简化显示
    var shortName = voice.name.replace(/Microsoft\s+/i, '').replace(/\s*Online\s*/i, '').replace(/\s*\(Natural\)/i, '').replace(/\s*\(Natural\)\s*/i, '');
    var typeTag = voice.localService ? '（本地）' : '（在线）';
    return shortName + typeTag;
  }

  function initSpeechVoices() {
    function loadVoices() {
      var voices = [];
      try { voices = speechSynthesis.getVoices(); } catch (e) { return; }
      if (voices.length === 0) return;

      voicesLoaded = true;
      state.voice.voices = voices;
      var select = DOM.voiceSelect;
      select.innerHTML = '';

      // 筛选中文语音
      var zhVoices = voices.filter(function (v) {
        return v.lang && (v.lang.indexOf('zh') === 0 || v.lang.indexOf('cmn') === 0);
      });

      if (zhVoices.length > 0) {
        // 排序：在线语音优先（更自然），然后女声
        zhVoices.sort(function (a, b) {
          // 在线语音优先（更自然）
          if (!a.localService && b.localService) return -1;
          if (a.localService && !b.localService) return 1;
          // 女声优先
          var aFemale = /female|女|xiaoxiao|xiaoyan|zhiyu|xiaoyi|yunxia|xiaobei|xiaoni|hsiaochen|hsiaoyu|hiugaai|hiumaan|huihui|yaoyao/i.test(a.name);
          var bFemale = /female|女|xiaoxiao|xiaoyan|zhiyu|xiaoyi|yunxia|xiaobei|xiaoni|hsiaochen|hsiaoyu|hiugaai|hiumaan|huihui|yaoyao/i.test(b.name);
          if (aFemale && !bFemale) return -1;
          if (!aFemale && bFemale) return 1;
          return 0;
        });

        zhVoices.forEach(function (voice, i) {
          var opt = document.createElement('option');
          opt.value = i;
          opt.textContent = getFriendlyVoiceName(voice);
          select.appendChild(opt);
        });

        // 默认选择第一个（已排序，优先在线语音）
        state.voice.selectedVoice = zhVoices[0];
        select.value = 0;
      } else {
        voices.forEach(function (voice, i) {
          var opt = document.createElement('option');
          opt.value = i;
          opt.textContent = getFriendlyVoiceName(voice);
          select.appendChild(opt);
        });
        state.voice.selectedVoice = voices[0];
      }
    }

    loadVoices();
    try {
      if (typeof speechSynthesis !== 'undefined' && speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = loadVoices;
      }
    } catch (e) {}

    setTimeout(function () { if (!voicesLoaded) loadVoices(); }, 1000);
    setTimeout(function () { if (!voicesLoaded) loadVoices(); }, 3000);
  }

  // ---- 事件绑定 ----
  function bindEvents() {
    DOM.themeToggle.addEventListener('click', toggleTheme);
    DOM.retryBtn.addEventListener('click', loadNewsData);
    DOM.vcPlayPause.addEventListener('click', togglePlayPause);
    DOM.vcStop.addEventListener('click', stopSpeech);
    DOM.vcPrev.addEventListener('click', playPrev);
    DOM.vcNext.addEventListener('click', playNext);

    DOM.speedSlider.addEventListener('input', function (e) {
      state.voice.rate = parseFloat(e.target.value);
      DOM.speedLabel.textContent = state.voice.rate.toFixed(1) + 'x';
      if (state.voice.utterance && !state.voice.isPaused) {
        speechSynthesis.cancel();
        speakCurrentItem();
      }
    });

    DOM.voiceSelect.addEventListener('change', function (e) {
      var idx = parseInt(e.target.value, 10);
      var zhVoices = state.voice.voices.filter(function (v) {
        return v.lang && (v.lang.indexOf('zh') === 0 || v.lang.indexOf('cmn') === 0);
      });
      if (zhVoices.length > 0 && zhVoices[idx]) {
        state.voice.selectedVoice = zhVoices[idx];
      } else {
        state.voice.selectedVoice = state.voice.voices[idx] || null;
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.code === 'Space' && state.voice.isPlaying) {
        e.preventDefault();
        togglePlayPause();
      } else if (e.code === 'Escape') {
        stopSpeech();
      }
    });

    DOM.batchPlayBtn.addEventListener('click', function () {
      if (state.voice.isPlaying && state.voice.isBatchMode) {
        togglePlayPause();
      } else {
        startBatchPlay();
      }
    });
  }

  // ---- 数据加载（ES5 兼容，使用 XMLHttpRequest 替代 fetch） ----
  function loadNewsData() {
    showLoading(true);
    hideError();
    hideEmpty();

    var timestamp = new Date().getTime();
    var url = 'news.json?t=' + timestamp;

    // 使用 XMLHttpRequest 替代 fetch，兼容所有浏览器
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 15000;
    xhr.responseType = 'json';

    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        var data = xhr.response;
        if (!data || typeof data !== 'object' || objectKeys(data).length === 0) {
          showLoading(false);
          showError('新闻数据为空');
          return;
        }

        state.newsData = data;

        // 提取可用日期并排序（降序）
        state.availableDates = objectKeys(data).sort(function (a, b) {
          return b > a ? 1 : b < a ? -1 : 0;
        });

        if (state.availableDates.length === 0) {
          showLoading(false);
          showError('没有可用的新闻日期');
          return;
        }

        state.selectedDate = state.availableDates[0];
        state.selectedCategory = '全部';

        updateNavDate();
        renderDateSelector();
        renderCategoryTabs();
        renderNews();
        showLoading(false);
      } else {
        showLoading(false);
        showError('HTTP ' + xhr.status + ': ' + xhr.statusText);
      }
    };

    xhr.onerror = function () {
      showLoading(false);
      showError('网络请求失败，请检查网络连接后重试');
    };

    xhr.ontimeout = function () {
      showLoading(false);
      showError('网络请求超时，请检查网络后重试');
    };

    try {
      xhr.send();
    } catch (e) {
      showLoading(false);
      showError('数据加载异常: ' + (e.message || e));
    }
  }

  // ---- 导航栏日期 ----
  function updateNavDate() {
    if (!state.selectedDate) return;
    var parts = state.selectedDate.split('-');
    var date = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    var weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    var formatted = date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日 星期' + weekDays[date.getDay()];
    DOM.navDate.textContent = formatted;
  }

  // ---- 日期选择器 ----
  function renderDateSelector() {
    var container = DOM.dateSelector;
    container.innerHTML = '<span class="date-label">📅</span>';

    state.availableDates.forEach(function (dateStr, index) {
      var btn = document.createElement('button');
      btn.className = 'date-btn' + (dateStr === state.selectedDate ? ' active' : '');
      btn.textContent = DATE_LABELS[index] || dateStr;
      btn.setAttribute('data-date', dateStr);
      btn.addEventListener('click', function () { selectDate(dateStr); });
      container.appendChild(btn);
    });
  }

  function selectDate(dateStr) {
    if (dateStr === state.selectedDate) return;
    state.selectedDate = dateStr;
    state.expandedCards.clear();

    var btns = $$('.date-btn');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].getAttribute('data-date') === dateStr) {
        btns[i].classList.add('active');
      } else {
        btns[i].classList.remove('active');
      }
    }

    updateNavDate();
    renderNews();
  }

  // ---- 分类标签 ----
  function renderCategoryTabs() {
    var container = DOM.categoryTabs;
    container.innerHTML = '';

    CATEGORIES.forEach(function (cat) {
      var tab = document.createElement('button');
      tab.className = 'category-tab' + (cat.name === state.selectedCategory ? ' active' : '');
      tab.setAttribute('data-category', cat.name);

      var html = '<span class="tab-icon">' + cat.icon + '</span><span>' + cat.name + '</span>';
      if (cat.name !== '全部') {
        html += '<span class="tab-count">5</span>';
      }
      tab.innerHTML = html;

      tab.addEventListener('click', function () { selectCategory(cat.name); });
      container.appendChild(tab);
    });
  }

  function selectCategory(catName) {
    if (catName === state.selectedCategory) return;
    state.selectedCategory = catName;
    state.expandedCards.clear();

    var tabs = $$('.category-tab');
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].getAttribute('data-category') === catName) {
        tabs[i].classList.add('active');
      } else {
        tabs[i].classList.remove('active');
      }
    }

    renderNews();
  }

  // ---- 新闻渲染 ----
  function renderNews() {
    var dateData = state.newsData[state.selectedDate];
    if (!dateData) {
      showEmpty();
      DOM.statsText.textContent = '';
      return;
    }

    hideEmpty();

    // 获取当前分类的新闻
    var newsList = [];
    if (state.selectedCategory === '全部') {
      var cats = objectKeys(dateData);
      for (var c = 0; c < cats.length; c++) {
        var items = dateData[cats[c]];
        if (isArray(items)) {
          for (var j = 0; j < items.length; j++) {
            var item = items[j];
            newsList.push({
              title: item.title,
              time: item.time,
              source: item.source,
              summary: item.summary,
              url: item.url,
              category: cats[c]
            });
          }
        }
      }
    } else {
      var catItems = dateData[state.selectedCategory];
      if (isArray(catItems)) {
        for (var k = 0; k < catItems.length; k++) {
          var ci = catItems[k];
          newsList.push({
            title: ci.title,
            time: ci.time,
            source: ci.source,
            summary: ci.summary,
            url: ci.url,
            category: state.selectedCategory
          });
        }
      }
    }

    // 更新统计
    var totalCategories = objectKeys(dateData).length;
    var totalNews = 0;
    var cats2 = objectKeys(dateData);
    for (var m = 0; m < cats2.length; m++) {
      if (isArray(dateData[cats2[m]])) totalNews += dateData[cats2[m]].length;
    }

    if (state.selectedCategory === '全部') {
      DOM.statsText.innerHTML = '共 <strong>' + totalCategories + '</strong> 个领域 · <strong>' + totalNews + '</strong> 条新闻';
    } else {
      DOM.statsText.innerHTML = '<strong>' + state.selectedCategory + '</strong> · 共 <strong>' + newsList.length + '</strong> 条新闻';
    }

    if (newsList.length === 0) {
      showEmpty();
      return;
    }

    // 渲染卡片
    DOM.newsGrid.innerHTML = '';
    for (var n = 0; n < newsList.length; n++) {
      var card = createNewsCard(newsList[n], n);
      DOM.newsGrid.appendChild(card);
    }

    updateBatchPlayButton();
  }

  function createNewsCard(news, index) {
    var card = document.createElement('article');
    card.className = 'news-card';
    card.setAttribute('data-index', index);

    if (state.expandedCards.has(index)) card.classList.add('expanded');

    var catColors = {
      '宏观政策风向': 'var(--cat-policy)',
      '产业科技趋势': 'var(--cat-tech)',
      '商业创业机会': 'var(--cat-business)',
      '投资理财参考': 'var(--cat-finance)',
      '社会民生变化': 'var(--cat-life)'
    };
    var catColor = catColors[news.category] || 'var(--text-accent)';

    card.innerHTML =
      '<div class="news-card-inner">' +
        '<div class="news-card-header">' +
          '<h3 class="news-card-title">' + escapeHtml(news.title) + '</h3>' +
          '<button class="voice-btn" data-index="' + index + '" title="语音播报" aria-label="播报此条新闻">🔊</button>' +
        '</div>' +
        '<div class="news-card-meta">' +
          '<span class="news-card-source" style="color: ' + catColor + '; border-left: 2px solid ' + catColor + ';">' + escapeHtml(news.category) + '</span>' +
          '<span class="news-card-source">' + escapeHtml(news.source) + '</span>' +
          '<span class="news-card-time">🕐 ' + escapeHtml(news.time) + '</span>' +
        '</div>' +
        '<p class="news-card-summary">' + renderSummary(news.summary) + '</p>' +
        '<div class="news-card-link-area">' +
          '<a class="news-card-link" href="' + escapeHtml(news.url) + '" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">🔗 查看原文<span>→</span></a>' +
        '</div>' +
      '</div>';

    card.addEventListener('click', function (e) {
      if (e.target && e.target.closest) {
        if (e.target.closest('.voice-btn') || e.target.closest('.news-card-link')) return;
      }
      toggleCardExpand(card, index);
    });

    var voiceBtn = card.querySelector('.voice-btn');
    voiceBtn.addEventListener('click', function (e) {
      if (e.stopPropagation) e.stopPropagation();
      playSingleNews(index);
    });

    return card;
  }

  function toggleCardExpand(card, index) {
    if (state.expandedCards.has(index)) {
      state.expandedCards.delete(index);
      card.classList.remove('expanded');
    } else {
      state.expandedCards.add(index);
      card.classList.add('expanded');
    }
  }

  // ---- 语音播报 ----
  function getNewsList() {
    var dateData = state.newsData[state.selectedDate];
    if (!dateData) return [];

    var newsList = [];
    if (state.selectedCategory === '全部') {
      var cats = objectKeys(dateData);
      for (var c = 0; c < cats.length; c++) {
        var items = dateData[cats[c]];
        if (isArray(items)) {
          for (var j = 0; j < items.length; j++) {
            var item = items[j];
            newsList.push({
              title: item.title, time: item.time, source: item.source,
              summary: item.summary, url: item.url, category: cats[c]
            });
          }
        }
      }
    } else {
      var catItems = dateData[state.selectedCategory];
      if (isArray(catItems)) {
        for (var k = 0; k < catItems.length; k++) {
          var ci = catItems[k];
          newsList.push({
            title: ci.title, time: ci.time, source: ci.source,
            summary: ci.summary, url: ci.url, category: state.selectedCategory
          });
        }
      }
    }
    return newsList;
  }

  function playSingleNews(index) {
    var newsList = getNewsList();
    if (index < 0 || index >= newsList.length) return;
    state.voice.playlist = newsList;
    state.voice.currentIndex = index;
    state.voice.isBatchMode = false;
    startSpeaking();
  }

  function startBatchPlay() {
    var newsList = getNewsList();
    if (newsList.length === 0) return;
    state.voice.playlist = newsList;
    state.voice.currentIndex = 0;
    state.voice.isBatchMode = true;
    startSpeaking();
  }

  function startSpeaking() {
    if (state.voice.playlist.length === 0) return;
    state.voice.isPlaying = true;
    state.voice.isPaused = false;
    updateVoiceControlBar();
    updateBatchPlayButton();
    updateVoiceButtonStates();
    speakCurrentItem();
  }

  function speakCurrentItem() {
    var news = state.voice.playlist[state.voice.currentIndex];
    if (!news) { stopSpeech(); return; }

    speechSynthesis.cancel();

    var text = news.title + '。' + (news.summary || '');

    if (!text.replace(/^\s+|\s+$/g, '')) {
      if (state.voice.isBatchMode && state.voice.currentIndex < state.voice.playlist.length - 1) {
        state.voice.currentIndex++;
        speakCurrentItem();
      } else { stopSpeech(); }
      return;
    }

    var utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = state.voice.rate;
    utterance.pitch = 1;
    utterance.volume = 1;

    // 获取可用语音
    var voices = [];
    try { voices = speechSynthesis.getVoices(); } catch (e) {}
    var zhVoices = voices.filter(function (v) {
      return v.lang && (v.lang.indexOf('zh') === 0 || v.lang.indexOf('cmn') === 0);
    });

    // 设置语音 - 带回退
    var voiceToUse = null;
    if (state.voice.selectedVoice) {
      var isAvailable = voices.some(function (v) { return v.name === state.voice.selectedVoice.name; });
      if (isAvailable) voiceToUse = state.voice.selectedVoice;
    }

    if (!voiceToUse && zhVoices.length > 0) {
      // 优先在线语音（更自然），回退本地语音
      var onlineVoice = zhVoices.find(function (v) { return !v.localService; });
      if (onlineVoice) {
        voiceToUse = onlineVoice;
      } else {
        voiceToUse = zhVoices[0];
      }
      state.voice.selectedVoice = voiceToUse;
    }

    if (voiceToUse) utterance.voice = voiceToUse;
    state.voice.utterance = utterance;

    DOM.voiceTitle.textContent = news.title;
    DOM.voiceStatus.textContent = '第 ' + (state.voice.currentIndex + 1) + ' / ' + state.voice.playlist.length + ' 条';

    utterance.onend = function () {
      if (state.voice.isBatchMode && state.voice.currentIndex < state.voice.playlist.length - 1) {
        state.voice.currentIndex++;
        setTimeout(function () { speakCurrentItem(); }, 100);
      } else {
        stopSpeech();
      }
    };

    utterance.onerror = function (e) {
      if (e.error === 'canceled' || e.error === 'interrupted') return;

      // synthesis-failed: 尝试不指定语音重试
      if (e.error === 'synthesis-failed' && utterance.voice) {
        DOM.voiceStatus.textContent = '切换语音重试中...';
        var retry = new SpeechSynthesisUtterance(text);
        retry.lang = 'zh-CN';
        retry.rate = state.voice.rate;
        retry.pitch = 1;
        retry.volume = 1;
        // 不设置 voice，让浏览器自己选

        retry.onend = utterance.onend;
        retry.onerror = function (e2) {
          if (e2.error === 'canceled' || e2.error === 'interrupted') return;
          DOM.voiceStatus.textContent = '播报失败: ' + e2.error;
          if (state.voice.isBatchMode && state.voice.currentIndex < state.voice.playlist.length - 1) {
            state.voice.currentIndex++;
            setTimeout(function () { speakCurrentItem(); }, 500);
          } else {
            setTimeout(function () { stopSpeech(); }, 1000);
          }
        };

        try { speechSynthesis.speak(retry); } catch (ex) { stopSpeech(); }
        return;
      }

      DOM.voiceStatus.textContent = '播报出错: ' + e.error;
      if (state.voice.isBatchMode && state.voice.currentIndex < state.voice.playlist.length - 1) {
        state.voice.currentIndex++;
        setTimeout(function () { speakCurrentItem(); }, 500);
      } else {
        stopSpeech();
      }
    };

    // 延迟执行 speak，确保 cancel 生效
    setTimeout(function () {
      try { speechSynthesis.speak(utterance); }
      catch (speakError) {
        DOM.voiceStatus.textContent = '语音功能不可用';
        stopSpeech();
      }
    }, 50);
  }

  function togglePlayPause() {
    if (!state.voice.isPlaying) {
      if (state.voice.playlist.length > 0 && state.voice.isPaused) {
        state.voice.isPaused = false;
        speechSynthesis.resume();
        updateVoiceControlBar();
        updateBatchPlayButton();
      }
      return;
    }

    if (state.voice.isPaused) {
      state.voice.isPaused = false;
      speechSynthesis.resume();
    } else {
      state.voice.isPaused = true;
      speechSynthesis.pause();
    }
    updateVoiceControlBar();
    updateBatchPlayButton();
  }

  function stopSpeech() {
    speechSynthesis.cancel();
    state.voice.isPlaying = false;
    state.voice.isPaused = false;
    state.voice.utterance = null;
    if (!state.voice.isBatchMode) state.voice.playlist = [];
    updateVoiceControlBar();
    updateBatchPlayButton();
    updateVoiceButtonStates();
  }

  function playPrev() {
    if (state.voice.playlist.length === 0) return;
    if (state.voice.currentIndex > 0) {
      state.voice.currentIndex--;
      speechSynthesis.cancel();
      state.voice.isPaused = false;
      speakCurrentItem();
    }
  }

  function playNext() {
    if (state.voice.playlist.length === 0) return;
    if (state.voice.currentIndex < state.voice.playlist.length - 1) {
      state.voice.currentIndex++;
      speechSynthesis.cancel();
      state.voice.isPaused = false;
      speakCurrentItem();
    }
  }

  function updateVoiceControlBar() {
    if (state.voice.isPlaying || state.voice.isPaused) {
      DOM.voiceControlBar.classList.add('visible');
      DOM.vcPlayPause.textContent = state.voice.isPaused ? '▶️' : '⏸️';
      DOM.vcPlayPause.title = state.voice.isPaused ? '继续播放' : '暂停';
    } else {
      DOM.voiceControlBar.classList.remove('visible');
    }
  }

  function updateBatchPlayButton() {
    if (state.voice.isPlaying && state.voice.isBatchMode) {
      DOM.batchPlayBtn.classList.add('playing');
      DOM.batchPlayIcon.textContent = '⏸️';
      DOM.batchPlayText.textContent = '暂停播报';
    } else {
      DOM.batchPlayBtn.classList.remove('playing');
      DOM.batchPlayIcon.textContent = '▶️';
      DOM.batchPlayText.textContent = '连续播报';
    }
  }

  function updateVoiceButtonStates() {
    var btns = $$('.voice-btn');
    for (var i = 0; i < btns.length; i++) {
      var idx = parseInt(btns[i].getAttribute('data-index'), 10);
      var isActive = state.voice.isPlaying && state.voice.currentIndex === idx;
      if (isActive) {
        btns[i].classList.add('playing');
        btns[i].textContent = '⏸️';
      } else {
        btns[i].classList.remove('playing');
        btns[i].textContent = '🔊';
      }
    }
  }

  // ---- UI 状态切换 ----
  function showLoading(show) {
    DOM.loadingState.style.display = show ? 'flex' : 'none';
    if (show) {
      DOM.newsGrid.style.display = 'none';
      DOM.errorState.style.display = 'none';
      DOM.emptyState.style.display = 'none';
    }
  }

  function showError(message) {
    DOM.errorMessage.textContent = message || '无法获取新闻数据，请检查网络连接后重试。';
    DOM.errorState.style.display = 'flex';
    DOM.newsGrid.style.display = 'none';
    DOM.loadingState.style.display = 'none';
  }

  function hideError() {
    DOM.errorState.style.display = 'none';
  }

  function showEmpty() {
    DOM.emptyState.style.display = 'flex';
    DOM.newsGrid.style.display = 'none';
  }

  function hideEmpty() {
    DOM.emptyState.style.display = 'none';
    DOM.newsGrid.style.display = '';
  }

  // ---- 工具函数 ----
  function renderSummary(summary) {
    if (!summary) return '';
    var html = escapeHtml(summary);
    
    // 新格式：【核心内容】和【深度思考】
    if (summary.indexOf('【核心内容】') !== -1 || summary.indexOf('【深度思考】') !== -1) {
      html = html.replace(/【核心内容】/g, '<span class="summary-core">【核心内容】</span>');
      html = html.replace(/【深度思考】/g, '<span class="summary-think">【深度思考】</span>');
      // 将换行符转换为段落分隔
      html = html.replace(/\n/g, '<br>');
      return html;
    }
    
    // 旧格式兼容：【新闻核心】【个人机会点】【风险预警】
    if (summary.indexOf('【新闻核心】') !== -1 || summary.indexOf('【个人机会点】') !== -1 || summary.indexOf('【风险预警】') !== -1) {
      html = html.replace(/【新闻核心】/g, '<span class="summary-core">【新闻核心】</span>');
      html = html.replace(/【个人机会点】/g, '<span class="summary-opportunity">【个人机会点】</span>');
      html = html.replace(/【风险预警】/g, '<span class="summary-risk">【风险预警】</span>');
      return html;
    }
    
    return escapeHtml(summary);
  }

  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- iOS Safari 语音 keep-alive ----
  function startIOSKeepAlive() {
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (!isIOS) return;
    setInterval(function () {
      if (state.voice.isPlaying) return;
      try {
        var u = new SpeechSynthesisUtterance('');
        u.volume = 0;
        speechSynthesis.speak(u);
      } catch (e) {}
    }, 20000);
  }

  // ---- 启动 ----
  document.addEventListener('DOMContentLoaded', function () {
    try {
      init();
      startIOSKeepAlive();
    } catch (e) {
      console.error('初始化失败:', e);
      showError('页面初始化失败，请刷新重试');
    }
  });

})();
