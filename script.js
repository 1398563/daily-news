/**
 * ============================================
 * 个人机会雷达 - 前端逻辑
 * ============================================
 */

(function () {
  'use strict';

  // ---- 常量配置 ----
  const CATEGORIES = [
    { name: '全部', icon: '🎯' },
    { name: '宏观政策风向', icon: '🏛️' },
    { name: '产业科技趋势', icon: '🔬' },
    { name: '商业创业机会', icon: '💼' },
    { name: '投资理财参考', icon: '📈' },
    { name: '社会民生变化', icon: '🏠' }
  ];

  const DATE_LABELS = {
    0: '今天',
    1: '昨天',
    2: '前天'
  };

  // ---- 状态管理 ----
  const state = {
    newsData: null,           // news.json 全部数据
    availableDates: [],       // 可用日期列表（降序）
    selectedDate: null,       // 当前选中日期
    selectedCategory: '全部', // 当前选中分类
    theme: 'dark',            // 当前主题
    expandedCards: new Set(), // 已展开的卡片索引
    // 语音播报状态
    voice: {
      isPlaying: false,
      isPaused: false,
      currentIndex: 0,       // 当前播报的新闻索引
      playlist: [],           // 播报列表
      isBatchMode: false,     // 是否为连续播报模式
      utterance: null,
      rate: 1.0,
      selectedVoice: null,
      voices: []
    }
  };

  // ---- DOM 元素引用 ----
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const DOM = {
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
    // 语音控制栏
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
  async function init() {
    initTheme();
    initSpeechVoices();
    bindEvents();
    await loadNewsData();
  }

  // ---- 主题管理 ----
  function initTheme() {
    // 优先读取本地存储，否则检测系统偏好
    const saved = localStorage.getItem('news-theme');
    if (saved) {
      state.theme = saved;
    } else {
      state.theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    applyTheme();
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    // 更新 meta theme-color
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.content = state.theme === 'dark' ? '#0a0e1a' : '#f5f7fb';
    }
  }

  function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('news-theme', state.theme);
    applyTheme();
  }

  // ---- 语音初始化 ----
  let voicesLoaded = false;

  function initSpeechVoices() {
    // 加载可用语音列表
    function loadVoices() {
      const voices = speechSynthesis.getVoices();
      if (voices.length === 0) return;

      voicesLoaded = true;
      state.voice.voices = voices;
      const select = DOM.voiceSelect;
      select.innerHTML = '';

      // 筛选中文语音
      const zhVoices = voices.filter(v =>
        v.lang.startsWith('zh') || v.lang.startsWith('cmn')
      );

      if (zhVoices.length > 0) {
        zhVoices.forEach((voice, i) => {
          const opt = document.createElement('option');
          opt.value = i;
          opt.textContent = `${voice.name} (${voice.lang})`;
          opt.dataset.voiceName = voice.name;
          opt.dataset.voiceLang = voice.lang;
          select.appendChild(opt);
        });
        // 默认选择第一个中文女声
        const defaultFemale = zhVoices.findIndex(v =>
          /female|女|zhiyu|xiaoxiao|xiaoyan/i.test(v.name)
        );
        state.voice.selectedVoice = zhVoices[defaultFemale >= 0 ? defaultFemale : 0];
        select.value = defaultFemale >= 0 ? defaultFemale : 0;
      } else {
        // 没有中文语音，显示所有语音
        voices.forEach((voice, i) => {
          const opt = document.createElement('option');
          opt.value = i;
          opt.textContent = `${voice.name} (${voice.lang})`;
          select.appendChild(opt);
        });
        state.voice.selectedVoice = voices[0];
      }
    }

    loadVoices();
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = loadVoices;
    }

    // 部分浏览器（尤其是移动端）语音加载较慢，设置超时重试
    setTimeout(() => {
      if (!voicesLoaded) {
        loadVoices();
      }
    }, 1000);
    setTimeout(() => {
      if (!voicesLoaded) {
        loadVoices();
      }
    }, 3000);
  }

  // ---- 事件绑定 ----
  function bindEvents() {
    // 主题切换
    DOM.themeToggle.addEventListener('click', toggleTheme);

    // 重试按钮
    DOM.retryBtn.addEventListener('click', loadNewsData);

    // 语音控制栏
    DOM.vcPlayPause.addEventListener('click', togglePlayPause);
    DOM.vcStop.addEventListener('click', stopSpeech);
    DOM.vcPrev.addEventListener('click', playPrev);
    DOM.vcNext.addEventListener('click', playNext);

    // 语速滑块
    DOM.speedSlider.addEventListener('input', (e) => {
      state.voice.rate = parseFloat(e.target.value);
      DOM.speedLabel.textContent = state.voice.rate.toFixed(1) + 'x';
      // 如果正在播报，实时调整语速
      if (state.voice.utterance && !state.voice.isPaused) {
        speechSynthesis.cancel();
        speakCurrentItem();
      }
    });

    // 语音选择
    DOM.voiceSelect.addEventListener('change', (e) => {
      const idx = parseInt(e.target.value);
      const zhVoices = state.voice.voices.filter(v =>
        v.lang.startsWith('zh') || v.lang.startsWith('cmn')
      );
      if (zhVoices.length > 0 && zhVoices[idx]) {
        state.voice.selectedVoice = zhVoices[idx];
      } else {
        state.voice.selectedVoice = state.voice.voices[idx] || null;
      }
    });

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.code === 'Space' && state.voice.isPlaying) {
        e.preventDefault();
        togglePlayPause();
      } else if (e.code === 'Escape') {
        stopSpeech();
      }
    });
  }

  // ---- 数据加载 ----
  async function loadNewsData() {
    showLoading(true);
    hideError();
    hideEmpty();

    try {
      // 添加时间戳防止缓存
      const timestamp = new Date().getTime();

      // 添加超时控制（移动端网络可能较慢）
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(`news.json?t=${timestamp}`, {
        signal: controller.signal,
        cache: 'no-cache'
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
        throw new Error('新闻数据为空');
      }

      state.newsData = data;

      // 提取可用日期并排序（降序）
      state.availableDates = Object.keys(state.newsData).sort((a, b) => b.localeCompare(a));

      // 默认选中最新日期
      state.selectedDate = state.availableDates[0];
      state.selectedCategory = '全部';

      // 更新导航栏日期
      updateNavDate();

      // 渲染日期选择器
      renderDateSelector();

      // 渲染分类标签
      renderCategoryTabs();

      // 渲染新闻列表
      renderNews();

      showLoading(false);
    } catch (error) {
      console.error('加载新闻数据失败:', error);
      showLoading(false);
      let errorMsg = error.message || '未知错误';
      if (error.name === 'AbortError') {
        errorMsg = '网络请求超时，请检查网络后重试';
      }
      showError(errorMsg);
    }
  }

  // ---- 导航栏日期 ----
  function updateNavDate() {
    if (!state.selectedDate) return;
    const date = new Date(state.selectedDate);
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    const formatted = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 星期${weekDays[date.getDay()]}`;
    DOM.navDate.textContent = formatted;
  }

  // ---- 日期选择器 ----
  function renderDateSelector() {
    const container = DOM.dateSelector;
    // 保留日期标签
    container.innerHTML = '<span class="date-label">📅</span>';

    state.availableDates.forEach((dateStr, index) => {
      const btn = document.createElement('button');
      btn.className = 'date-btn' + (dateStr === state.selectedDate ? ' active' : '');
      btn.textContent = DATE_LABELS[index] || dateStr;
      btn.dataset.date = dateStr;
      btn.addEventListener('click', () => selectDate(dateStr));
      container.appendChild(btn);
    });
  }

  function selectDate(dateStr) {
    if (dateStr === state.selectedDate) return;
    state.selectedDate = dateStr;
    state.expandedCards.clear();

    // 更新日期按钮状态
    $$('.date-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.date === dateStr);
    });

    updateNavDate();
    renderNews();
  }

  // ---- 分类标签 ----
  function renderCategoryTabs() {
    const container = DOM.categoryTabs;
    container.innerHTML = '';

    CATEGORIES.forEach(cat => {
      const tab = document.createElement('button');
      tab.className = 'category-tab' + (cat.name === state.selectedCategory ? ' active' : '');
      tab.dataset.category = cat.name;
      tab.innerHTML = `
        <span class="tab-icon">${cat.icon}</span>
        <span>${cat.name}</span>
        ${cat.name !== '全部' ? '<span class="tab-count">5</span>' : ''}
      `;
      tab.addEventListener('click', () => selectCategory(cat.name));
      container.appendChild(tab);
    });
  }

  function selectCategory(catName) {
    if (catName === state.selectedCategory) return;
    state.selectedCategory = catName;
    state.expandedCards.clear();

    // 更新标签状态
    $$('.category-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.category === catName);
    });

    renderNews();
  }

  // ---- 新闻渲染 ----
  function renderNews() {
    const dateData = state.newsData[state.selectedDate];
    if (!dateData) {
      showEmpty();
      DOM.statsText.textContent = '';
      return;
    }

    hideEmpty();

    // 获取当前分类的新闻
    let newsList = [];
    if (state.selectedCategory === '全部') {
      // 合并所有分类
      Object.entries(dateData).forEach(([category, items]) => {
        items.forEach(item => {
          newsList.push({ ...item, category });
        });
      });
    } else {
      newsList = (dateData[state.selectedCategory] || []).map(item => ({
        ...item,
        category: state.selectedCategory
      }));
    }

    // 更新统计
    const totalCategories = Object.keys(dateData).length;
    const totalNews = Object.values(dateData).reduce((sum, items) => sum + items.length, 0);
    if (state.selectedCategory === '全部') {
      DOM.statsText.innerHTML = `共 <strong>${totalCategories}</strong> 个领域 · <strong>${totalNews}</strong> 条新闻`;
    } else {
      const count = newsList.length;
      DOM.statsText.innerHTML = `<strong>${state.selectedCategory}</strong> · 共 <strong>${count}</strong> 条新闻`;
    }

    if (newsList.length === 0) {
      showEmpty();
      return;
    }

    // 渲染卡片
    DOM.newsGrid.innerHTML = '';
    newsList.forEach((news, index) => {
      const card = createNewsCard(news, index);
      DOM.newsGrid.appendChild(card);
    });

    // 更新批量播报按钮
    updateBatchPlayButton();
  }

  function createNewsCard(news, index) {
    const card = document.createElement('article');
    card.className = 'news-card';
    card.dataset.index = index;

    const isExpanded = state.expandedCards.has(index);
    if (isExpanded) card.classList.add('expanded');

    // 分类颜色标签
    const catColors = {
      '宏观政策风向': 'var(--cat-policy)',
      '产业科技趋势': 'var(--cat-tech)',
      '商业创业机会': 'var(--cat-business)',
      '投资理财参考': 'var(--cat-finance)',
      '社会民生变化': 'var(--cat-life)'
    };
    const catColor = catColors[news.category] || 'var(--text-accent)';

    card.innerHTML = `
      <div class="news-card-inner">
        <div class="news-card-header">
          <h3 class="news-card-title">${escapeHtml(news.title)}</h3>
          <button class="voice-btn" data-index="${index}" title="语音播报" aria-label="播报此条新闻">
            🔊
          </button>
        </div>
        <div class="news-card-meta">
          <span class="news-card-source" style="color: ${catColor}; border-left: 2px solid ${catColor};">${escapeHtml(news.category)}</span>
          <span class="news-card-source">${escapeHtml(news.source)}</span>
          <span class="news-card-time">🕐 ${escapeHtml(news.time)}</span>
        </div>
        <p class="news-card-summary">${renderSummary(news.summary)}</p>
        <div class="news-card-link-area">
          <a class="news-card-link" href="${escapeHtml(news.url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">
            🔗 查看原文
            <span>→</span>
          </a>
        </div>
      </div>
    `;

    // 卡片点击展开/收起
    card.addEventListener('click', (e) => {
      // 排除语音按钮和链接的点击
      if (e.target.closest('.voice-btn') || e.target.closest('.news-card-link')) return;
      toggleCardExpand(card, index);
    });

    // 语音播报按钮
    const voiceBtn = card.querySelector('.voice-btn');
    voiceBtn.addEventListener('click', (e) => {
      e.stopPropagation();
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
    const dateData = state.newsData[state.selectedDate];
    if (!dateData) return [];

    let newsList = [];
    if (state.selectedCategory === '全部') {
      Object.entries(dateData).forEach(([category, items]) => {
        items.forEach(item => {
          newsList.push({ ...item, category });
        });
      });
    } else {
      newsList = (dateData[state.selectedCategory] || []).map(item => ({
        ...item,
        category: state.selectedCategory
      }));
    }
    return newsList;
  }

  function playSingleNews(index) {
    const newsList = getNewsList();
    if (index < 0 || index >= newsList.length) return;

    state.voice.playlist = newsList;
    state.voice.currentIndex = index;
    state.voice.isBatchMode = false;
    startSpeaking();
  }

  function startBatchPlay() {
    const newsList = getNewsList();
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
    const news = state.voice.playlist[state.voice.currentIndex];
    if (!news) {
      stopSpeech();
      return;
    }

    // iOS Safari 修复：在 speak 之前先 cancel 并等待一帧
    speechSynthesis.cancel();

    const text = `${news.title}。${news.summary || ''}`;

    // 检查文本是否为空
    if (!text.trim()) {
      console.warn('语音播报文本为空，跳过');
      if (state.voice.isBatchMode && state.voice.currentIndex < state.voice.playlist.length - 1) {
        state.voice.currentIndex++;
        speakCurrentItem();
      } else {
        stopSpeech();
      }
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = state.voice.rate;
    utterance.pitch = 1;
    utterance.volume = 1;

    // 设置语音
    if (state.voice.selectedVoice) {
      utterance.voice = state.voice.selectedVoice;
    } else {
      // 如果语音还没加载，尝试重新获取
      const voices = speechSynthesis.getVoices();
      const zhVoices = voices.filter(v => v.lang.startsWith('zh') || v.lang.startsWith('cmn'));
      if (zhVoices.length > 0) {
        state.voice.selectedVoice = zhVoices[0];
        utterance.voice = zhVoices[0];
      }
    }

    state.voice.utterance = utterance;

    // 更新控制栏
    DOM.voiceTitle.textContent = news.title;
    DOM.voiceStatus.textContent = `第 ${state.voice.currentIndex + 1} / ${state.voice.playlist.length} 条`;

    utterance.onend = () => {
      if (state.voice.isBatchMode && state.voice.currentIndex < state.voice.playlist.length - 1) {
        // 连续播报下一条
        state.voice.currentIndex++;
        // iOS Safari 修复：添加小延迟防止连续 speak 被吞
        setTimeout(() => speakCurrentItem(), 100);
      } else {
        // 播报结束
        stopSpeech();
      }
    };

    utterance.onerror = (e) => {
      if (e.error === 'canceled' || e.error === 'interrupted') return;
      console.error('语音播报错误:', e.error);
      // 显示错误提示
      DOM.voiceStatus.textContent = '播报出错: ' + e.error;
      // 尝试继续下一条
      if (state.voice.isBatchMode && state.voice.currentIndex < state.voice.playlist.length - 1) {
        state.voice.currentIndex++;
        setTimeout(() => speakCurrentItem(), 500);
      } else {
        stopSpeech();
      }
    };

    // iOS Safari 修复：使用 requestAnimationFrame 确保 cancel 生效后再 speak
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        speechSynthesis.speak(utterance);
      });
    });
  }

  function togglePlayPause() {
    if (!state.voice.isPlaying) {
      // 如果有播放列表但暂停了，恢复播放
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

    // 如果不是批量模式，清除播放列表
    if (!state.voice.isBatchMode) {
      state.voice.playlist = [];
    }

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
    const bar = DOM.voiceControlBar;
    if (state.voice.isPlaying || state.voice.isPaused) {
      bar.classList.add('visible');
      DOM.vcPlayPause.textContent = state.voice.isPaused ? '▶️' : '⏸️';
      DOM.vcPlayPause.title = state.voice.isPaused ? '继续播放' : '暂停';
    } else {
      bar.classList.remove('visible');
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
    // 更新卡片上的语音按钮状态
    $$('.voice-btn').forEach(btn => {
      const idx = parseInt(btn.dataset.index);
      const isActive = state.voice.isPlaying && state.voice.currentIndex === idx;
      btn.classList.toggle('playing', isActive);
      btn.textContent = isActive ? '⏸️' : '🔊';
    });
  }

  // 批量播报按钮事件
  DOM.batchPlayBtn.addEventListener('click', () => {
    if (state.voice.isPlaying && state.voice.isBatchMode) {
      togglePlayPause();
    } else {
      startBatchPlay();
    }
  });

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
    // 检测是否为三段式格式
    if (summary.includes('【新闻核心】') || summary.includes('【个人机会点】') || summary.includes('【风险预警】')) {
      let html = escapeHtml(summary);
      // 【新闻核心】默认颜色
      html = html.replace(/【新闻核心】/g, '<span class="summary-core">【新闻核心】</span>');
      // 【个人机会点】绿色加粗
      html = html.replace(/【个人机会点】/g, '<span class="summary-opportunity">【个人机会点】</span>');
      // 【风险预警】红色加粗
      html = html.replace(/【风险预警】/g, '<span class="summary-risk">【风险预警】</span>');
      return html;
    }
    return escapeHtml(summary);
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- iOS Safari 语音 keep-alive ----
  // iOS Safari 在页面加载约 30 秒后 speechSynthesis 会停止工作
  // 通过定期触发一个空 utterance 来保持活跃
  let iosKeepAlive = null;
  function startIOSKeepAlive() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (!isIOS) return;

    iosKeepAlive = setInterval(() => {
      if (state.voice.isPlaying) return; // 正在播报不需要
      const u = new SpeechSynthesisUtterance('');
      u.volume = 0;
      speechSynthesis.speak(u);
    }, 20000);
  }

  // ---- 启动 ----
  document.addEventListener('DOMContentLoaded', () => {
    init();
    startIOSKeepAlive();
  });

})();
