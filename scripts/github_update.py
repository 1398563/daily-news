#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GitHub自动更新模块
- 通过GitHub API将更新后的news.json提交到仓库
- 支持创建仓库、上传文件、配置GitHub Pages
"""

import json
import os
import sys
import base64
import logging
from datetime import datetime
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
CONFIG_PATH = os.path.join(SCRIPT_DIR, 'config.json')

GITHUB_API = "https://api.github.com"


def load_config():
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)


def github_api_request(config, method, path, data=None):
    """发送GitHub API请求"""
    token = config['github']['token']
    url = f"{GITHUB_API}{path}"

    headers = {
        'Authorization': f'token {token}',
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'DailyNewsBot/1.0'
    }

    body = None
    if data is not None:
        body = json.dumps(data).encode('utf-8')
        headers['Content-Type'] = 'application/json'

    req = Request(url, data=body, headers=headers, method=method)

    try:
        with urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode('utf-8')), resp.status
    except HTTPError as e:
        error_body = e.read().decode('utf-8') if e.fp else ''
        logger.error(f"GitHub API错误 [{method} {path}]: {e.code} {error_body}")
        return {'error': str(e), 'code': e.code}, e.code
    except URLError as e:
        logger.error(f"GitHub API请求失败 [{method} {path}]: {e}")
        return {'error': str(e)}, 0


def create_repo(config):
    """创建GitHub仓库（如果不存在）"""
    owner = config['github']['repo_owner']
    repo_name = config['github']['repo_name']

    # 检查仓库是否已存在
    result, status = github_api_request(config, 'GET', f'/repos/{owner}/{repo_name}')

    if status == 200:
        logger.info(f"仓库已存在: {owner}/{repo_name}")
        return True

    # 创建新仓库
    logger.info(f"创建新仓库: {owner}/{repo_name}")
    data = {
        'name': repo_name,
        'description': '每日AI新闻简报 - 自动聚合多领域新闻',
        'homepage': f'https://{owner}.github.io/{repo_name}/',
        'auto_init': False,
        'private': False
    }

    result, status = github_api_request(config, 'POST', '/user/repos', data)

    if status in (200, 201):
        logger.info(f"仓库创建成功: {result.get('html_url')}")
        return True
    else:
        logger.error(f"仓库创建失败: {result}")
        return False


def get_file_sha(config, path):
    """获取文件当前SHA（用于更新）"""
    owner = config['github']['repo_owner']
    repo = config['github']['repo_name']
    branch = config['github']['branch']

    result, status = github_api_request(config, 'GET',
        f'/repos/{owner}/{repo}/contents/{path}?ref={branch}')

    if status == 200:
        return result.get('sha')
    return None


def upload_file_to_github(config, file_path, repo_path, message=None):
    """
    上传/更新单个文件到GitHub仓库
    """
    owner = config['github']['repo_owner']
    repo = config['github']['repo_name']
    branch = config['github']['branch']

    # 读取文件内容
    with open(file_path, 'rb') as f:
        content = base64.b64encode(f.read()).decode('utf-8')

    # 获取当前SHA（如果文件已存在）
    sha = get_file_sha(config, repo_path)

    if message is None:
        now = datetime.now().strftime('%Y-%m-%d %H:%M')
        action = "更新" if sha else "添加"
        message = f"{action} {repo_path} - {now}"

    data = {
        'message': message,
        'content': content,
        'branch': branch
    }

    if sha:
        data['sha'] = sha

    result, status = github_api_request(config, 'PUT',
        f'/repos/{owner}/{repo}/contents/{repo_path}', data)

    if status in (200, 201):
        logger.info(f"文件上传成功: {repo_path}")
        return True
    else:
        logger.error(f"文件上传失败: {repo_path} - {result}")
        return False


def deploy_all_files(config):
    """
    部署所有网站文件到GitHub
    """
    files_to_deploy = [
        ('index.html', 'index.html'),
        ('style.css', 'style.css'),
        ('script.js', 'script.js'),
        ('news.json', 'news.json'),
    ]

    success_count = 0
    for local_name, repo_path in files_to_deploy:
        local_path = os.path.join(PROJECT_DIR, local_name)
        if os.path.exists(local_path):
            if upload_file_to_github(config, local_path, repo_path):
                success_count += 1
        else:
            logger.warning(f"文件不存在: {local_path}")

    logger.info(f"部署完成: {success_count}/{len(files_to_deploy)} 个文件成功")
    return success_count == len(files_to_deploy)


def update_news_json(config):
    """仅更新news.json文件"""
    news_path = os.path.join(PROJECT_DIR, 'news.json')
    if not os.path.exists(news_path):
        logger.error("news.json 不存在，请先运行 fetch_news.py")
        return False

    return upload_file_to_github(config, news_path, 'news.json',
        message=f"更新每日新闻 - {datetime.now().strftime('%Y-%m-%d %H:%M')}")


def enable_github_pages(config):
    """启用GitHub Pages"""
    owner = config['github']['repo_owner']
    repo = config['github']['repo_name']

    data = {
        'source': {
            'branch': config['github']['branch'],
            'path': '/'
        }
    }

    result, status = github_api_request(config, 'POST',
        f'/repos/{owner}/{repo}/pages', data)

    if status in (200, 201):
        logger.info(f"GitHub Pages 已启用: https://{owner}.github.io/{repo}/")
        return True
    elif status == 409:
        logger.info("GitHub Pages 已处于启用状态")
        return True
    else:
        logger.warning(f"启用GitHub Pages失败（可手动启用）: {result}")
        return False


def get_site_url(config):
    """获取网站URL"""
    owner = config['github']['repo_owner']
    repo = config['github']['repo_name']
    return f"https://{owner}.github.io/{repo}/"


if __name__ == '__main__':
    config = load_config()

    if len(sys.argv) > 1:
        action = sys.argv[1]
        if action == 'create_repo':
            create_repo(config)
        elif action == 'deploy_all':
            create_repo(config)
            deploy_all_files(config)
            enable_github_pages(config)
        elif action == 'update_news':
            update_news_json(config)
        elif action == 'enable_pages':
            enable_github_pages(config)
    else:
        # 默认：仅更新news.json
        update_news_json(config)
