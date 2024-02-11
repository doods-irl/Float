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

    socket.on('createFolder', (folderPath) => {
        const fullPath = path.join(contentPath, folderPath);

        fs.ensureDir(fullPath, err => {
            if (err) {
                console.error('Error creating folder:', err);
                // You can also emit an error message back to the client if needed
                socket.emit('folderCreationError', 'Failed to create folder');
            } else {
                console.log(`Folder created: ${fullPath}`);
                // Optionally, emit the updated file tree
                emitFileTree(socket);
            }
        });
    });

    socket.on('createArticle', (filePath) => {
        const fullPath = path.join(contentPath, filePath);
    
        // Use fs.outputFile to create a new file
        fs.outputFile(fullPath, '', err => { // Starts with an empty file
            if (err) {
                console.error('Error creating article:', err);
                socket.emit('articleCreationError', 'Failed to create article');
            } else {
                console.log(`Article created: ${fullPath}`);
                emitFileTree(socket);
            }
        });
    });

    socket.on('saveFileContent', (data) => {
        const fullPath = path.join(contentPath, data.filePath);
        fs.writeFile(fullPath, data.content, 'utf8', err => {
            if (err) {
                console.error('Error writing file:', err);
                // Emit an error response if needed
                socket.emit('saveFileContentError', 'Failed to save file');
            } else {
                console.log(`File saved: ${fullPath}`);
                // Emit a success response if needed
                socket.emit('saveFileContentSuccess', 'File saved successfully');
            }
        });
    });
});


// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});