
import os
import hmac
import hashlib
import json
import time

from urllib.parse import parse_qsl
from flask import Flask, request, jsonify
from flask_cors import CORS

import database

app = Flask(__name__)

CORS(
    app,
    origins=["https://guadon545.github.io"]
)

# Создаём таблицы базы данных
database.init_db()

# Автоматически добавляем администраторов из Render
admin_ids = os.getenv("ADMIN_IDS", "")

for admin_id in admin_ids.split(","):
    if admin_id.strip().isdigit():
        database.add_admin(int(admin_id.strip()))

BOT_TOKEN = os.getenv("BOT_TOKEN")


def verify_telegram_data(init_data):
    if not BOT_TOKEN or not init_data:
        return None

    try:
        data = dict(parse_qsl(init_data))
        received_hash = data.pop("hash", None)

        if not received_hash:
            return None

        auth_date = int(data.get("auth_date", "0"))

        if auth_date > time.time() + 60:
            return None

        if time.time() - auth_date > 86400:
            return None

        check_string = "\n".join(
            f"{key}={value}"
            for key, value in sorted(data.items())
        )

        secret_key = hmac.new(
            BOT_TOKEN.encode(),
            b"WebAppData",
            hashlib.sha256
        ).digest()

        calculated_hash = hmac.new(
            secret_key,
            check_string.encode(),
            hashlib.sha256
        ).hexdigest()

        if not hmac.compare_digest(
            calculated_hash,
            received_hash
        ):
            return None

        return json.loads(data["user"])

    except Exception:
        return None


def get_telegram_user():
    init_data = request.headers.get(
        "X-Telegram-Init-Data", ""
    )

    return verify_telegram_data(init_data)


@app.route("/")
def home():
    return "GUADON COIN SERVER IS ONLINE!"


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


@app.route("/api/balance")
def balance():
    user = get_telegram_user()

    if not user:
        return jsonify({
            "error": "Telegram authorization failed"
        }), 401

    user_id = user.get("id")
    username = user.get("username")

    if not user_id:
        return jsonify({
            "error": "User ID missing"
        }), 400

    database.register_user(user_id, username)

    return jsonify({
        "user_id": user_id,
        "username": username,
        "balance": database.get_balance(user_id),
        "currency": "DC"
    })


@app.route("/api/admin/status")
def admin_status():
    user = get_telegram_user()

    if not user:
        return jsonify({"error": "Authorization failed"}), 401

    user_id = user.get("id")

    return jsonify({
        "is_admin": database.is_admin(user_id)
    })


@app.route("/api/admin/give-dc", methods=["POST"])
def admin_give_dc():
    user = get_telegram_user()

    if not user:
        return jsonify({"error": "Authorization failed"}), 401

    admin_id = user.get("id")

    if not database.is_admin(admin_id):
        return jsonify({"error": "Нет доступа"}), 403

    data = request.get_json(silent=True) or {}

    try:
        target_id = int(data.get("user_id"))
        amount = int(data.get("amount"))
    except (TypeError, ValueError):
        return jsonify({"error": "Неверные данные"}), 400

    if target_id <= 0 or amount <= 0:
        return jsonify({"error": "Сумма и ID должны быть положительными"}), 400

    database.register_user(target_id)
    database.change_balance(
        target_id,
        amount,
        "admin_give",
        admin_id
    )

    return jsonify({
        "success": True,
        "message": f"Выдано {amount} DC",
        "balance": database.get_balance(target_id)
    })
