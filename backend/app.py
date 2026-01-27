from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import uuid

from modules.transcriber import transcribe_audio
from modules.summarizer import summarize_text
from tasks import tasks, run_background_task


app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


def process_audio(file_path):
    transcript = transcribe_audio(file_path)
    summary = summarize_text(transcript)

    return {
        "transcript": transcript,
        "summary": summary
    }


@app.route("/upload", methods=["POST"])
def upload_audio():
    audio = request.files.get("audio")
    if not audio:
        return jsonify({"error": "No audio file"}), 400

    task_id = str(uuid.uuid4())
    file_path = os.path.join(UPLOAD_FOLDER, f"{task_id}.wav")
    audio.save(file_path)

    tasks[task_id] = {
        "status": "queued",
        "result": None
    }

    run_background_task(task_id, process_audio, file_path)

    return jsonify({
        "task_id": task_id,
        "message": "Audio uploaded. Processing started."
    })


@app.route("/status/<task_id>")
def get_status(task_id):
    task = tasks.get(task_id)

    if not task:
        return jsonify({"error": "Invalid task ID"}), 404

    return jsonify({
        "status": task["status"],
        "result": task.get("result")
    })


if __name__ == "__main__":
    app.run(debug=True)
