#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
一键部署脚本
- 创建GitHub仓库
- 上传所有网站文件
- 启用GitHub Pages
- 测试飞书机器人连接

使用方式：
  python deploy.py
"""

import sys
import os
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)

from github_update import load_config, create_repo, deploy_all_files, enable_github_pages, get_site_url
from feishu_notify import load_config as load_feishu_config, send_test_message, send_news_card


def main():
    print("=" * 60)
    print("  每日AI新闻简报 - 一键部署脚本")
    print("=" * 60)
    print()

    config = load_config()

    # 检查必要配置
    required_fields = [
        ('github.token', config['github'].get('token')),
        ('github.repo_owner', config['github'].get('repo_owner')),
    ]

    missing = [f for f, v in required_fields if not v or v.startswith('YOUR_')]
    if missing:
        print("❌ 请先完成配置！以下字段需要填写：")
        for field in missing:
            print(f"   - {field}")
        print()
        print("请编辑 scripts/config.json 文件，填入您的配置信息。")
        print()
        print("获取方式：")
        print("  GitHub Token: https://github.com/settings/tokens")
        print("    → Generate new token (classic)")
        print("    → 勾选 repo 权限")
        print("  天行API Key: https://www.tianapi.com 注册后获取")
        print("  DeepSeek Key: https://platform.deepseek.com 注册后获取")
        return False

    # 步骤1：创建GitHub仓库
    print("📦 步骤 1/4: 创建GitHub仓库...")
    if not create_repo(config):
        print("❌ 仓库创建失败，请检查GitHub Token是否有效")
        return False
    print("✅ 仓库就绪")
    print()

    # 步骤2：上传文件
    print("📤 步骤 2/4: 上传网站文件...")
    if not deploy_all_files(config):
        print("❌ 文件上传失败")
        return False
    print("✅ 文件上传完成")
    print()

    # 步骤3：启用GitHub Pages
    print("🌐 步骤 3/4: 启用GitHub Pages...")
    enable_github_pages(config)
    site_url = get_site_url(config)
    print(f"✅ 网站地址: {site_url}")
    print()

    # 步骤4：测试飞书机器人
    print("📨 步骤 4/4: 测试飞书机器人...")
    webhook = config['feishu'].get('webhook_url', '')
    if webhook and not webhook.startswith('YOUR_'):
        if send_test_message(config):
            print("✅ 飞书机器人连接成功")
        else:
            print("⚠️ 飞书机器人发送失败，请检查Webhook地址")
    else:
        print("⏭️ 跳过飞书测试（未配置Webhook）")
    print()

    # 完成
    print("=" * 60)
    print("  🎉 部署完成！")
    print("=" * 60)
    print()
    print(f"  🌐 网站地址: {site_url}")
    print(f"  📱 GitHub Pages 通常需要 1-3 分钟生效")
    print()
    print("  后续步骤：")
    print("  1. 编辑 scripts/config.json 填入天行API Key和AI Key")
    print("  2. 运行 python scripts/main.py --test 测试飞书连接")
    print("  3. 运行 python scripts/main.py 执行首次新闻更新")
    print("  4. 配置定时任务（cron）每天 08:00 自动执行")
    print()

    return True


if __name__ == '__main__':
    success = main()
    sys.exit(0 if success else 1)
