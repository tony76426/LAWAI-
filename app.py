
from flask import Flask, request, jsonify
from flask_cors import CORS
import openai
import os
import traceback

app = Flask(__name__)
CORS(app)

# 讀取 OpenAI 金鑰
openai.api_key = os.environ.get("OPENAI_API_KEY")

@app.route("/")
def home():
    return "🟢 Flask Law AI Server is Running."

@app.route("/api/generate", methods=["POST"])
def generate():
    try:
        data = request.get_json()
        messages = data.get("messages", [])
        model = data.get("model", "gpt-3.5-turbo")
        temperature = data.get("temperature", 0.5)

        if not messages or not isinstance(messages, list):
            return jsonify({"error": "Invalid or missing 'messages'"}), 400

        response = openai.ChatCompletion.create(
            model=model,
            messages=messages,
            temperature=temperature,
        )
        return jsonify(response)
    except Exception as e:
        traceback.print_exc()
        return jsonify({
            "error": str(e),
            "tip": "請確認是否已正確設定 OPENAI_API_KEY，並啟用正確的模型"
        }), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
