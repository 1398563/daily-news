#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
个人机会雷达 - 飞书推送模块
"""

import json
import os
import sys
import hashlib
import hmac
import base64
import time
import logging
from datetime import datetime
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(SCRIPT_DIR, 'config.json')


def load_config():
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)


def gen_sign(secret):
    timestamp = str(int(time.time()))
    string_to_sign = f"{timestamp}\n{secret}"
    hmac_code = hmac.new(
        string_to_sign.encode("utf-8"),
        b'',
        digestmod=hashlib.sha256
    ).digest()
    sign = base64.b64encode(hmac_code).decode('utf-8')
    return timestamp, sign


def send_feishu_message(config, message_type, content):
    webhook_url = config['feishu']['webhook_url']
    sign_secret = config['feishu'].get('sign_secret', '')

    payload = {
        'msg_type': message_type,
        'content': content
    }

    if sign_secret:
        timestamp, sign = gen_sign(sign_secret)
        payload['timestamp'] = timestamp
        payload['sign'] = sign

    body = json.dumps(payload).encode('utf-8')
    req = Request(webhook_url, data=body, headers={
        'Content-Type': 'application/json',
        'User-Agent': 'OpportunityRadar/1.0'
    })

    try:
        with urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read().decode('utf-8'))
        if result.get('code') == 0 or result.get('StatusCode') == 0:
            logger.info("飞书消息发送成功")
            return True
        else:
            logger.error(f"飞书消息发送失败: {result}")
            return False
    except (URLError, HTTPError) as e:
        logger.error(f"飞书消息发送异常: {e}")
        return False


def send_text_message(config, text):
    return send_feishu_message(config, 'text', {'text': text})


def send_news_card(config, site_url, news_stats, news_data=None, error_msg=None):
    """发送个人机会雷达通知"""
    today = datetime.now().strftime('%Y年%m月%d日')
    now_time = datetime.now().strftime('%H:%M')

    if error_msg:
        text = f"【个人机会雷达】更新失败\n日期：{today}\n错误信息：{error_msg}\n请及时检查处理。"
        return send_text_message(config, text)

    categories = news_stats.get('categories', 0)
    total = news_stats.get('total', 0)
    days = news_stats.get('keep_days', 3)

    # 从新闻数据中提取今日重点机会和风险
    highlight_opportunity = ""
    highlight_risk = ""
    if news_data:
        for cat_name, items in news_data.items():
            for item in items:
                summary = item.get('summary', '')
                if '【个人机会点】' in summary and not highlight_opportunity:
                    # 提取第一个机会点
                    try:
                        opp_part = summary.split('【个人机会点】')[1].split('【')[0].strip()
                        if opp_part:
                            highlight_opportunity = opp_part[:60]
                    except (IndexError, AttributeError):
                        pass
                if '【风险预警】' in summary and not highlight_risk:
                    try:
                        risk_part = summary.split('【风险预警】')[1].strip()
                        if risk_part:
                            highlight_risk = risk_part[:60]
                    except (IndexError, AttributeError):
                        pass
                if highlight_opportunity and highlight_risk:
                    break
            if highlight_opportunity and highlight_risk:
                break

    content = {
        "zh_cn": {
            "title": f"【个人机会雷达】{today}",
            "content": [
                [
                    {"tag": "text", "text": f"更新状态：✅ 已完成\n"}
                ],
                [
                    {"tag": "text", "text": f"新闻数量：{categories}个领域 {total}条新闻\n"}
                ],
                [
                    {"tag": "text", "text": f"历史记录：保留近{days}天\n"}
                ],
                [
                    {"tag": "text", "text": f"语音播报：🔊 已支持\n"}
                ]
            ]
        }
    }

    if highlight_opportunity:
        content["zh_cn"]["content"].append([
            {"tag": "text", "text": f"💡 今日重点机会：{highlight_opportunity}\n"}
        ])
    if highlight_risk:
        content["zh_cn"]["content"].append([
            {"tag": "text", "text": f"⚠️ 今日重点风险：{highlight_risk}\n"}
        ])

    content["zh_cn"]["content"].append([
        {"tag": "a", "text": "🔍 点击查看全部机会雷达", "href": site_url}
    ])
    content["zh_cn"]["content"].append([
        {"tag": "text", "text": f"由AI自动采集与总结 · {now_time} 更新"}
    ])

    return send_feishu_message(config, 'post', {'post': content})


def send_test_message(config):
    return send_text_message(config, "✅ 飞书机器人连接测试成功！个人机会雷达已就绪。")


if __name__ == '__main__':
    config = load_config()
    if len(sys.argv) > 1:
        action = sys.argv[1]
        if action == 'test':
            send_test_message(config)
        elif action == 'card':
            site_url = sys.argv[2] if len(sys.argv) > 2 else "https://example.github.io/daily-news/"
            stats = {'categories': 5, 'total': 30, 'keep_days': 3}
            send_news_card(config, site_url, stats)
    else:
        send_test_message(config)
