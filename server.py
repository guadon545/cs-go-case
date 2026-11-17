import os
import hmac
import hashlib
import json
import time
import base64

from urllib.parse import parse_qsl
from flask import Flask, request, jsonify
from flask_cors import CORS

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

import database

app = Flask(__name__)

CORS(
    app,
    origins=["https://guadon545.github.io"],
    allow_headers=["Content-Type", "X-Telegram-Init-Data"],
    methods=["GET", "POST", "OPTIONS"]
)

database.init_db()

admin_ids = os.getenv("ADMIN_IDS", "")

for admin_id in admin_ids.split(","):
    if admin_id.strip().isdigit():
        database.add_admin(int(admin_id.strip()))

BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()

# Публичный ключ Telegram для обычного (не тестового) окружения
TELEGRAM_PUBLIC_KEY = bytes.fromhex(
    "e7bf03a2fa4602af4580703d88dda5bb"
    "59f32ed8b02a56c187fe7d34caed242d"
)


def verify_telegram_data(init_data):
    if not BOT_TOKEN:
        print("AUTH DEBUG: BOT_TOKEN missing")
        return None

    if not init_data:
        print("AUTH DEBUG: initData missing")
        return None

    try:
        data = dict(parse_qsl(init_data, keep_blank_values=True))

        print("AUTH DEBUG: fields:", sorted(data.keys()))

        auth_date = int(data.get("auth_date", "0"))

        if auth_date > time.time() + 60:
            print("AUTH DEBUG: auth_date in future")
            return None

        if time.time() - auth_date > 86400:
            print("AUTH DEBUG: initData expired")
            return None

        # Вариант 1: проверка HMAC через токен бота
        received_hash = data.get("hash")

        if received_hash:
            check_data = {
                key: value
                for key, value in data.items()
                if key != "hash"
            }

            check_string = "\n".join(
                f"{key}={value}"
                for key, value in sorted(check_data.items())
            )

            secret_key = hmac.new(
                b"WebAppData",
                BOT_TOKEN.encode(),
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
                print("AUTH DEBUG: HMAC hash mismatch")
                return None

        # Вариант 2: проверка Ed25519-подписи Telegram
        else:
            signature = data.get("signature")

            if not signature:
                print("AUTH DEBUG: hash and signature missing")
                return None

            bot_id = BOT_TOKEN.split(":")[0]

            check_data = {
                key: value
                for key, value in data.items()
                if key not in ("hash", "signature")
            }

            check_string = (
                f"{bot_id}:WebAppData\n"
                + "\n".join(
                    f"{key}={value}"
                    for key, value in sorted(check_data.items())
                )
            )

            signature_bytes = base64.urlsafe_b64decode(
                signature + "=" * (-len(signature) % 4)
            )

            public_key = Ed25519PublicKey.from_public_bytes(
                TELEGRAM_PUBLIC_KEY
            )

            public_key.verify(
                signature_bytes,
                check_string.encode()
            )

        user = json.loads(data["user"])

        print("AUTH DEBUG: authorization success")
        return user

    except Exception as error:
        print("AUTH DEBUG: verification error:", type(error).__name__)
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
        return jsonify({
            "error": "Сумма и ID должны быть положительными"
        }), 400

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


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)

