#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
个人机会雷达 - AI摘要增强模块
- 读取news.json
- 对每条新闻生成【核心内容】和【深度思考】摘要
- 支持天工AI、硅基流动、OpenAI兼容API
"""

import json
import os
import sys
import time
import logging

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
CONFIG_PATH = os.path.join(SCRIPT_DIR, 'config.json')

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s: %(message)s')
logger = logging.getLogger(__name__)


def load_config():
    """加载配置，支持环境变量覆盖"""
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        config = json.load(f)
    
    # 环境变量覆盖（用于 GitHub Actions）
    if os.environ.get('SILICONFLOW_KEY'):
        config.setdefault('ai', {})['siliconflow_key'] = os.environ['SILICONFLOW_KEY']
    if os.environ.get('TIANAPI_KEY'):
        config.setdefault('tianapi', {})['api_key'] = os.environ['TIANAPI_KEY']
    
    return config


def load_news_json():
    """加载news.json"""
    news_path = os.path.join(PROJECT_DIR, 'news.json')
    with open(news_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_news_json(data):
    """保存news.json"""
    news_path = os.path.join(PROJECT_DIR, 'news.json')
    with open(news_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    logger.info("news.json 已保存")


def call_ai_summarize(title, category, config):
    """
    调用AI生成摘要
    优先级: 天工AI(天行数据) > 硅基流动 > OpenAI兼容
    """
    import urllib.request
    import urllib.parse

    prompt = f"""你是一位资深新闻分析师。请为以下新闻生成简短摘要。

新闻标题：{title}
分类：{category}

请严格按以下格式生成摘要（两部分内容不要重复各有侧重）：

【核心内容】（100-150字）
提炼这条新闻的核心事实、关键数据和重要信息。要求：
- 不要简单重复标题
- 提供标题中没有的实质性内容
- 客观陈述，不加评论

【深度思考】（100-150字）
分析这条新闻对个人的影响和启示。要求：
- 指出可能带来的机会或风险
- 分析对行业或生活的影响
- 提出值得关注的信号或趋势

请直接输出摘要内容，不要加其他说明。"""

    # 方式1: 天工AI（通过天行数据API）
    tianapi_key = config.get('tianapi', {}).get('api_key', '')
    if tianapi_key:
        try:
            api_url = f"https://apis.tianapi.com/aicontent/index?key={tianapi_key}&content={urllib.parse.quote(prompt)}"
            req = urllib.request.Request(api_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=30) as resp:
                result = json.loads(resp.read().decode('utf-8'))
                if result.get('code') == 200:
                    content = result.get('result', {}).get('content', '').strip()
                    if content:
                        logger.info("  使用天工AI生成摘要")
                        return content
        except Exception as e:
            logger.debug(f"天工AI调用失败: {e}")

    # 方式2: 硅基流动 (免费额度)
    siliconflow_key = config.get('ai', {}).get('siliconflow_key', '')
    if siliconflow_key:
        try:
            req = urllib.request.Request(
                "https://api.siliconflow.cn/v1/chat/completions",
                data=json.dumps({
                    "model": "Qwen/Qwen2.5-7B-Instruct",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.3,
                    "max_tokens": 600
                }).encode('utf-8'),
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': f'Bearer {siliconflow_key}'
                },
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                result = json.loads(resp.read().decode('utf-8'))
                return result['choices'][0]['message']['content'].strip()
        except Exception as e:
            logger.debug(f"硅基流动调用失败: {e}")

    # 方式3: OpenAI兼容API
    openai_key = config.get('ai', {}).get('openai_key', '')
    openai_url = config.get('ai', {}).get('openai_url', 'https://api.openai.com/v1/chat/completions')
    openai_model = config.get('ai', {}).get('openai_model', 'gpt-3.5-turbo')

    if openai_key:
        try:
            req = urllib.request.Request(
                openai_url,
                data=json.dumps({
                    "model": openai_model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.3,
                    "max_tokens": 600
                }).encode('utf-8'),
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': f'Bearer {openai_key}'
                },
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                result = json.loads(resp.read().decode('utf-8'))
                return result['choices'][0]['message']['content'].strip()
        except Exception as e:
            logger.debug(f"OpenAI API调用失败: {e}")

    return None


def enhance_news_with_ai(config):
    """对news.json中的新闻进行AI摘要增强"""
    logger.info("开始AI摘要增强...")

    data = load_news_json()
    today = list(data.keys())[0] if data else None

    if not today:
        logger.warning("没有找到今天的新闻数据")
        return

    logger.info(f"处理日期: {today}")
    categories = data[today]
    total_news = sum(len(v) for v in categories.values())
    logger.info(f"共 {total_news} 条新闻待处理")

    enhanced_count = 0
    for cat_name, items in categories.items():
        for i, item in enumerate(items):
            # 如果已有完整摘要，跳过
            summary = item.get('summary', '')
            if '【核心内容】' in summary and '【深度思考】' in summary:
                logger.debug(f"  [{cat_name}] {item['title'][:30]}... 已有效摘要，跳过")
                continue

            title = item.get('title', '')
            logger.info(f"  [{cat_name}] {title[:40]}...")

            # 调用AI
            ai_summary = call_ai_summarize(title, cat_name, config)

            if ai_summary and len(ai_summary) > 20:
                # 验证格式
                if '【核心内容】' in ai_summary and '【深度思考】' in ai_summary:
                    data[today][cat_name][i]['summary'] = ai_summary
                    enhanced_count += 1
                    logger.info(f"    ✅ AI摘要生成成功 ({len(ai_summary)}字)")
                else:
                    logger.warning(f"    ⚠️ AI返回格式不符，使用原始摘要")
            else:
                logger.warning(f"    ⚠️ AI生成失败，保留原摘要")

            # 延迟避免API限流
            time.sleep(1)

    logger.info(f"AI摘要增强完成: {enhanced_count}/{total_news} 条")
    save_news_json(data)
    return enhanced_count


if __name__ == '__main__':
    config = load_config()
    count = enhance_news_with_ai(config)
    print(f"AI_ENHANCED={count}")
