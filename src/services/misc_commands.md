### Build whisper server
uv run --with pyinstaller --with flask --with flask-cors --with faster-whisper pyinstaller --onefile --name "selah-whisper-server-x86_64-pc-windows-msvc" --distpath . --clean whisper-server.py

### Build whisper server for linux
uv run --with pyinstaller --with flask --with flask-cors --with faster-whisper pyinstaller --onefile --name "selah-whisper-server-x86_64-pc-linux-gnu" --distpath . --clean whisper-server.py


### Build whisper server for mac
uv run --with pyinstaller --with flask --with flask-cors --with faster-whisper pyinstaller --onefile --name "selah-whisper-server-x86_64-apple-darwin" --distpath . --clean whisper-server.py

### Build selah desktop app for linux
tauri build --target x86_64-pc-linux-gnu

### Build selah desktop app for mac
tauri build --target x86_64-apple-darwin

### Build selah desktop app for windows
tauri build --target x86_64-pc-windows-msvc

### Copy wsl to local Windows
robocopy "\\wsl$\Ubuntu\home\daniel\code\selah" "C:\dev\selah" /E /XD .git node_modules .tauri target