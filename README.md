# 🎙️ AI Meeting Summarizer

An AI-powered web application that converts **meeting audio into structured summaries, transcripts, and logically divided sections** using **Speech-to-Text and Natural Language Processing**.

---

## 📌 Project Overview

Meetings are essential in organizations, but reviewing long meeting recordings is time-consuming and inefficient.  
The **AI Meeting Summarizer** automates this process by converting meeting audio into readable text, generating concise summaries, and organizing discussions into meaningful sections.

The system is built using **Python Full Stack technologies** and supports **long meeting recordings (10–20 minutes)** through background processing.

---

## 🎯 Objectives

- Convert meeting audio into text automatically
- Generate concise summaries in third-person perspective
- Provide full meeting transcripts
- Divide meetings into logical sections
- Handle long audio recordings efficiently
- Offer a clean and user-friendly interface

---

## 🧠 Key Features

### 🎧 Audio Processing
- Upload meeting audio files
- Supports long-duration audio recordings
- Handles different audio formats

### 🗣️ Speech-to-Text (Whisper AI)
- Uses **Whisper AI** for accurate transcription
- Supports multilingual audio input
- Works well for noisy and long meetings

### 📝 Meeting Summary Generation
- NLP-based summarization
- Generates short and meaningful summaries
- Written in **third-person point of view**

### 📄 Transcript Generation
- Full meeting transcript generation
- Clean and readable output
- Used as input for summarization and analysis

### 🧩 Logical Division of Meeting
- Automatically divides meetings into sections
- Identifies topic changes
- Improves readability and navigation

### ⚙️ Background Processing
- Processes long meetings asynchronously
- Keeps frontend responsive
- Shows processing progress

### 🎨 User Interface
- Modern React-based UI
- Feature-based navigation
- Dark mode support
- Download summary and transcript

---
User
|
React Frontend
|
Flask REST API
|
Whisper AI + NLP Modules
|
Processed Output (Summary, Transcript, Sections)
## 🏗️ System Architecture

---

## 🛠️ Technology Stack

### Frontend
- React.js
- HTML, CSS, JavaScript

### Backend
- Python 3.9+
- Flask
- Flask-CORS
- Background threading

### AI & NLP
- Whisper AI (Speech-to-Text)
- Natural Language Processing techniques

### Utilities
- FFmpeg (audio processing)
- Git & GitHub

---

## 🔄 Working Methodology

1. User uploads meeting audio
2. Audio is sent to Flask backend
3. Background processing starts
4. Whisper AI converts audio to text
5. NLP generates summary and sections
6. Results are returned to frontend
7. User views and downloads output

---

## ⚙️ Installation & Setup

### Prerequisites
- Python 3.9+
- Node.js 18+
- FFmpeg
- Git

---

### Backend Setup

python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt

python -m app
Frontend Setup
cd frontend
npm install
npm start

▶️ How to Use

Start backend server

Start frontend application

Open browser at http://localhost:3000

Upload meeting audio file

Click Generate Summary

View:

Summary

Transcript

Logical sections

Download results

📈 Performance & Evaluation

Supports 10–20 minute meeting audio

Accurate speech recognition

Responsive UI during processing

Clean and structured output

🚀 Future Enhancements

Live microphone recording

Action item extraction

Sentiment analysis

Speaker identification

Multilingual summary generation

PDF export

Database integration for meeting history

🎓 Academic Relevance

Degree: Master of Computer Applications (MCA)

Domain: Artificial Intelligence & Natural Language Processing

Key Concepts

Speech-to-Text

NLP-based summarization

Background processing

Human-computer interaction

📜 License

This project is developed for academic purposes.
All rights reserved © 2026.

👨‍💻 Author

Arron Ninan
MCA – Artificial Intelligence

GitHub: https://github.com/ArronNinan

⭐ Acknowledgements

OpenAI (Whisper AI)

Flask Community

React.js Community

Open-source NLP tools

