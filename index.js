const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");
const dirTree = require("directory-tree");

const contentPath = path.join(__dirname, 'content');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

function emitFileTree(socket) {
    
    try {
        const tree = dirTree(contentPath, {attributes: ['type'], extensions: /\.md/ });
        console.log(tree);
        socket.emit('fileTree', tree);
    } catch (error) {
        console.error('Error reading file tree:', error);
        socket.emit('fileTreeError', 'Failed to read file tree');
    }
}

// Serve static files from public directory
app.use(express.static('public'));

io.on('connection', (socket) => {
    console.log('A user connected');

    // Emit the file tree initially
    emitFileTree(socket);

    socket.on('requestFileContent', (filePath) => {
        const fullPath = path.join(contentPath, filePath);
        fs.readFile(fullPath, 'utf8', (err, data) => {
            if (err) {
                console.error('Error reading file:', err);
                socket.emit('fileContentError', 'Failed to read file');
            } else {
                socket.emit('fileContent', data);
            }
        });
    });
});


// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});