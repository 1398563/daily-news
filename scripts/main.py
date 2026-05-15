#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
个人机会雷达 - 主调度脚本
流程：
  1. 从天行数据API按关键词获取各分类新闻
  2. 更新本地news.json（清理超过3天的历史数据）
  3. AI生成摘要（【核心内容】+【深度思考】）
  4. 通过GitHub API提交更新到仓库
  5. 等待GitHub Pages生效
  6. 通过飞书机器人推送网站链接
"""

import sys
import os
import time
import logging
import traceback

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)

from fetch_news import load_config, fetch_all_news, update_news_json
from github_update import update_news_json as github_update_news, deploy_all_files, get_site_url
from feishu_notify import send_news_card, send_test_message
from enhance_news import enhance_news_with_ai

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s: %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(os.path.join(SCRIPT_DIR, 'daily.log'), encoding='utf-8')
    ]
)
logger = logging.getLogger(__name__)


def run_fetch(config):
    """获取新闻"""
    logger.info("=" * 50)
    logger.info("步骤 1/5: 获取新闻")
    logger.info("=" * 50)

    news_data = fetch_all_news(config)
    total = sum(len(v) for v in news_data.values())
    categories = sum(1 for v in news_data.values() if v)

    if total == 0:
        raise Exception("未获取到任何新闻数据")

    logger.info(f"获取完成: {categories}个分类, 共{total}条")
    return news_data, categories, total


def run_update_json(config, news_data):
    """更新news.json"""
    logger.info("=" * 50)
    logger.info("步骤 2/5: 更新news.json")
    logger.info("=" * 50)
    json_path = update_news_json(news_data)
    logger.info(f"news.json 已更新: {json_path}")
    return json_path


def run_ai_enhance(config):
    """AI摘要增强"""
    logger.info("=" * 50)
    logger.info("步骤 3/5: AI生成摘要")
    logger.info("=" * 50)
    enhanced = enhance_news_with_ai(config)
    if enhanced is not None:
        logger.info(f"AI摘要完成: {enhanced}条")
    return enhanced


def run_github_push(config):
    """推送到GitHub"""
    logger.info("=" * 50)
    logger.info("步骤 4/5: 推送到GitHub")
    logger.info("=" * 50)
    success = deploy_all_files(config)
    if not success:
        raise Exception("GitHub推送失败")
    logger.info("GitHub推送成功")
    return True


def run_notify(config, categories, total, error_msg=None):
    """飞书推送"""
    logger.info("=" * 50)
    logger.info("步骤 5/5: 飞书推送通知")
    logger.info("=" * 50)
    site_url = get_site_url(config)
    stats = {
        'categories': categories,
        'total': total,
        'keep_days': config['news'].get('keep_days', 3)
    }
    success = send_news_card(config, site_url, stats, error_msg=error_msg)
    if not success:
        logger.error("飞书推送失败")
    return success


def run_full_pipeline(config):
    """执行完整流程"""
    start_time = time.time()
    categories = 0
    total = 0

    try:
        news_data, categories, total = run_fetch(config)
        run_update_json(config, news_data)

        # AI摘要增强
        run_ai_enhance(config)

        run_github_push(config)

        logger.info("等待GitHub Pages生效（约30秒）...")
        time.sleep(30)

        run_notify(config, categories, total)

        elapsed = time.time() - start_time
        logger.info(f"✅ 全部流程完成！耗时 {elapsed:.1f} 秒")
        return True

    except Exception as e:
        logger.error(f"❌ 流程执行失败: {e}")
        logger.error(traceback.format_exc())
        try:
            run_notify(config, categories, total, error_msg=str(e))
        except Exception:
            logger.error("飞书失败通知也发送失败")
        return False


def main():
    config = load_config()
    args = sys.argv[1:]

    if '--test' in args:
        logger.info("测试飞书机器人连接...")
        send_test_message(config)
        return

    if '--fetch' in args:
        news_data, categories, total = run_fetch(config)
        update_news_json(news_data)
        logger.info(f"新闻获取完成: {total}条")
        return

    if '--ai' in args:
        run_ai_enhance(config)
        logger.info("AI摘要增强完成")
        return

    if '--push' in args:
        run_github_push(config)
        return

    if '--notify' in args:
        site_url = get_site_url(config)
        stats = {'categories': 5, 'total': 30, 'keep_days': 3}
        send_news_card(config, site_url, stats)
        return

    run_full_pipeline(config)


if __name__ == '__main__':
    main()
