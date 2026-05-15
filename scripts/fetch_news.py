#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
个人机会雷达 - 新闻获取模块
- 从天行数据API按分类获取大量新闻
- 在本地用关键词匹配筛选 + 排除词过滤
- 输出符合news.json格式的结构化数据
"""

import json
import hashlib
import os
import sys
import logging
from datetime import datetime, timedelta
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
from urllib.parse import urlencode

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
CONFIG_PATH = os.path.join(SCRIPT_DIR, 'config.json')

# 天行数据频道ID映射（用于获取大量原始新闻）
CHANNEL_MAP = {
    '宏观政策风向': [7, 8],       # 国内+国际
    '产业科技趋势': [13, 22, 29],  # 科技+IT+AI
    '商业创业机会': [7, 34, 24],   # 国内+互联网+创业
    '投资理财参考': [32, 7],       # 财经+国内
    '社会民生变化': [5, 7, 17],    # 社会+国内+健康
}


def load_config():
    """加载配置，支持环境变量覆盖"""
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        config = json.load(f)
    
    # 环境变量覆盖（用于 GitHub Actions）
    import os
    if os.environ.get('TIANAPI_KEY'):
        config['tianapi']['api_key'] = os.environ['TIANAPI_KEY']
    if os.environ.get('FEISHU_WEBHOOK'):
        config['feishu']['webhook_url'] = os.environ['FEISHU_WEBHOOK']
    if os.environ.get('FEISHU_SECRET'):
        config['feishu']['sign_secret'] = os.environ['FEISHU_SECRET']
    if os.environ.get('SILICONFLOW_KEY'):
        config.setdefault('ai', {})['siliconflow_key'] = os.environ['SILICONFLOW_KEY']
    if os.environ.get('GITHUB_TOKEN'):
        config['github']['token'] = os.environ['GITHUB_TOKEN']
    
    return config


def fetch_tianapi_by_col(config, col_id, num=50):
    """使用天行数据API按频道ID获取新闻"""
    api_key = config['tianapi']['api_key']
    base_url = config['tianapi']['base_url']

    url = f"{base_url}/allnews/index"
    params = {
        'key': api_key,
        'num': num,
        'col': col_id,
        'form': 1,
    }

    full_url = f"{url}?{urlencode(params)}"
    req = Request(full_url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    })

    try:
        with urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode('utf-8'))

        if data.get('code') != 200:
            return []

        result = data.get('result', {})
        return result.get('list', []) or result.get('data', [])

    except (URLError, HTTPError, json.JSONDecodeError):
        return []


def keyword_match(text, keywords):
    """检查文本是否包含任一关键词"""
    for kw in keywords:
        if kw in text:
            return True
    return False


def filter_by_exclude(news_list, exclude_words):
    """过滤包含排除关键词的新闻"""
    if not exclude_words:
        return news_list

    filtered = []
    for news in news_list:
        title = news.get('title', '')
        description = news.get('description', '')
        text = title + ' ' + description

        excluded = False
        for word in exclude_words:
            if word in text:
                excluded = True
                break

        if not excluded:
            filtered.append(news)

    return filtered


def deduplicate_news(all_news):
    """基于标题去重"""
    seen = set()
    unique = []
    for item in all_news:
        title = item.get('title', '').strip()
        if not title:
            continue
        title_key = ''.join(c for c in title if c not in ' \t\n\r，。！？、；：""''（）【】')
        title_hash = hashlib.md5(title_key.encode('utf-8')).hexdigest()[:8]
        if title_hash not in seen:
            seen.add(title_hash)
            unique.append(item)
    return unique


def format_time(time_str):
    """格式化时间"""
    if not time_str:
        return datetime.now().strftime('%Y-%m-%d %H:%M')
    for fmt in ['%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M', '%Y/%m/%d %H:%M:%S', '%Y/%m/%d %H:%M']:
        try:
            dt = datetime.strptime(time_str.strip(), fmt)
            return dt.strftime('%Y-%m-%d %H:%M')
        except ValueError:
            continue
    return datetime.now().strftime('%Y-%m-%d %H:%M')


def fetch_category_news(config, cat_name, cat_config):
    """
    获取单个分类的新闻
    策略：从多个频道获取大量新闻 → 关键词匹配 → 排除过滤 → 去重 → 截取
    """
    keywords = cat_config['keywords']
    exclude_words = cat_config.get('exclude', [])
    target_num = cat_config['num']

    # 获取该分类对应的频道
    channels = CHANNEL_MAP.get(cat_name, [7])

    # 从多个频道获取原始新闻
    all_raw = []
    for ch_id in channels:
        raw = fetch_tianapi_by_col(config, ch_id, num=50)
        all_raw.extend(raw)
        logger.info(f"  频道 col={ch_id} 获取 {len(raw)} 条")

    # 去重
    unique = deduplicate_news(all_raw)
    logger.info(f"  {cat_name} 去重后 {len(unique)} 条")

    # 关键词匹配筛选（标题或描述包含任一核心关键词）
    matched = []
    for news in unique:
        title = news.get('title', '')
        description = news.get('description', '')
        text = title + ' ' + description
        if keyword_match(text, keywords):
            matched.append(news)

    logger.info(f"  {cat_name} 关键词匹配后 {len(matched)} 条")

    # 排除过滤
    filtered = filter_by_exclude(matched, exclude_words)
    logger.info(f"  {cat_name} 排除过滤后 {len(filtered)} 条")

    # 如果匹配数量不足，用原始去重数据补充（排除过滤后）
    if len(filtered) < target_num:
        remaining = filter_by_exclude(unique, exclude_words)
        # 去掉已选中的
        existing_titles = set(n.get('title', '') for n in filtered)
        extra = [n for n in remaining if n.get('title', '') not in existing_titles]
        filtered.extend(extra[:target_num - len(filtered)])
        logger.info(f"  {cat_name} 补充后 {len(filtered)} 条")

    # 截取目标数量
    selected = filtered[:target_num]

    # 格式化输出
    results = []
    for news in selected:
        title = news.get('title', '')
        description = news.get('description', '')
        summary = description if description and description.strip() else title
        if len(summary) > 200:
            summary = summary[:200] + '...'

        results.append({
            'title': title,
            'time': format_time(news.get('ctime', '')),
            'source': news.get('source', '综合报道'),
            'summary': summary,
            'url': news.get('url', '')
        })

    return results


def fetch_all_news(config):
    """获取所有分类的新闻"""
    categories = config['news']['categories']
    all_results = {}

    for cat_name, cat_config in categories.items():
        logger.info(f"正在处理分类: {cat_name}")
        news_items = fetch_category_news(config, cat_name, cat_config)
        all_results[cat_name] = news_items
        logger.info(f"{cat_name} 完成: {len(news_items)} 条")

    return all_results


def update_news_json(new_data, config=None):
    """更新news.json，保留近3天"""
    news_json_path = os.path.join(PROJECT_DIR, 'news.json')
    today = datetime.now().strftime('%Y-%m-%d')

    keep_days = 3
    if config:
        keep_days = config['news'].get('keep_days', 3)

    existing_data = {}
    if os.path.exists(news_json_path):
        try:
            with open(news_json_path, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
        except (json.JSONDecodeError, IOError):
            pass

    existing_data[today] = new_data

    dates_to_keep = sorted(existing_data.keys(), reverse=True)[:keep_days]
    cleaned_data = {date: existing_data[date] for date in dates_to_keep}

    with open(news_json_path, 'w', encoding='utf-8') as f:
        json.dump(cleaned_data, f, ensure_ascii=False, indent=2)

    logger.info(f"news.json 更新完成，保留 {len(dates_to_keep)} 天: {dates_to_keep}")
    return news_json_path


if __name__ == '__main__':
    config = load_config()
    logger.info("========== 开始获取新闻 ==========")
    news_data = fetch_all_news(config)
    total = sum(len(v) for v in news_data.values())
    logger.info(f"========== 新闻获取完成，共 {total} 条 ==========")
    json_path = update_news_json(news_data)
    print(f"NEWS_JSON_PATH={json_path}")
