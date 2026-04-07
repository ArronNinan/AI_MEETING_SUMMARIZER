# AI Meeting Summarizer

An intelligent web application that transcribes audio/video meeting recordings and generates comprehensive summaries with key insights, action items, and structured reports.

## Features

- **Audio/Video Transcription**: Uses advanced Whisper AI model for accurate speech-to-text conversion
- **Intelligent Summarization**: Leverages LLM-powered analysis to extract key points, action items, and topics
- **Multi-format Reports**: Generate professional reports in DOCX and PDF formats
- **Real-time Processing**: Live transcription with chunked processing for long recordings
- **User Authentication**: Secure user accounts with session management
- **History Management**: Track and manage past transcriptions and summaries
- **File Upload Support**: Support for various audio/video formats
- **Translation Support**: Multi-language transcription capabilities
- **Speaker Diarization**: Identify different speakers in recordings

## Tech Stack

### Backend
- **Python** with Flask web framework
- **Whisper AI** (faster-whisper) for transcription
- **LLM Integration** for summarization and analysis
- **Flask-CORS** for cross-origin requests
- **PyDub** for audio processing
- **DOCX** library for Word document generation

### Frontend
- **React** 19.x with modern hooks
- **React Testing Library** for component testing
- **Web Vitals** for performance monitoring
- **React Icons** for UI elements

## Installation

### Prerequisites
- Python 3.8+
- Node.js 16+
- npm or yarn

### Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Create and activate a virtual environment:
   ```bash
   python -m venv venv
   venv\Scripts\activate  # On Windows
   # or
   source venv/bin/activate  # On macOS/Linux
   ```

3. Install Python dependencies:
   ```bash
   pip install flask flask-cors faster-whisper pydub requests
   ```

4. Install Node.js dependencies (for report generation):
   ```bash
   npm install
   ```

### Frontend Setup

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Usage

### Running the Application

1. Start the backend server:
   ```bash
   cd backend
   python app.py
   ```
   The backend will run on `http://localhost:5000`

2. Start the frontend development server:
   ```bash
   cd frontend
   npm start
   ```
   The frontend will run on `http://localhost:3000`

### Using the Application

1. **Register/Login**: Create an account or log in to access the application
2. **Upload Media**: Upload audio or video files of your meetings
3. **Transcription**: The system will automatically transcribe the audio
4. **Summarization**: AI-powered summarization extracts key points and insights
5. **Generate Reports**: Download structured reports in DOCX or PDF format
6. **View History**: Access past transcriptions and summaries

## API Endpoints

### Authentication
- `POST /auth/register` - User registration
- `POST /auth/login` - User login
- `POST /auth/logout` - User logout
- `GET /auth/me` - Get current user info
- `GET /auth/token` - Get authentication token

### Core Functionality
- `POST /upload` - Upload audio/video files
- `GET /status/<task_id>` - Check transcription status
- `POST /transcribe-chunk` - Transcribe audio chunks
- `POST /full-report` - Generate complete report
- `POST /translate` - Translate transcription
- `POST /diarize` - Perform speaker diarization

### Reports & Downloads
- `POST /download-docx` - Download DOCX report
- `POST /download-pdf` - Download PDF report
- `GET /history` - Get user history
- `DELETE /history/<entry_id>` - Delete history entry

## Configuration

### Environment Variables
- `WHISPER_MODEL` - Whisper model size (default: "base")
- `FULL_REPORT_TIMEOUT_SEC` - Report generation timeout (default: 420 seconds)

### Model Options
- `tiny` - Fastest, least accurate
- `base` - Good balance of speed and accuracy
- `small` - Better accuracy, slower
- `medium` - High accuracy, slower
- `large` - Best accuracy, slowest

## Project Structure

```
AI_MEETING_SUMMARIZER/
├── backend/
│   ├── app.py                 # Main Flask application
│   ├── tasks.py               # Background task management
│   ├── gen_report.js          # Report generation script
│   ├── modules/
│   │   ├── summarizer.py      # AI summarization logic
│   │   └── transcriber.py     # Whisper transcription
│   ├── uploads/               # Temporary file storage
│   ├── user_data/             # User history files
│   └── cache_exports/         # Cached reports
├── frontend/
│   ├── src/
│   │   ├── App.js             # Main React component
│   │   └── ...                # Other React components
│   ├── public/                # Static assets
│   └── build/                 # Production build
├── uploads/                   # Global uploads directory
└── user_data/                 # Global user data
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- OpenAI Whisper for speech recognition
- Faster-Whisper for optimized transcription
- React community for the frontend framework
- Flask community for the backend framework