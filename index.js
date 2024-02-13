const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");
const dirTree = require("directory-tree");
const searchIndex = require('search-index');

const contentPath = path.join(__dirname, 'content');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
let si;

async function indexDocuments() {
    console.log("Starting indexing process...");

    try {
        const index = await searchIndex({ name: 'knowledgebaseIndex' });

        si = index;

        console.log("Reading documents from:", contentPath);
        const documents = [];
        dirTree(contentPath, { attributes: ['type'], extensions: /\.md/ }, (item) => {
            const relativePath = item.path.replace(`${contentPath}\\`, ''); // Convert to relative path
            const filename = path.basename(item.path); // Extract filename
            const content = fs.readFileSync(item.path, 'utf8');
            documents.push({
                _id: relativePath,
                filename: filename,
                content: content,
            });
            console.log(documents);
        });    

        if (documents.length === 0) {
            console.log("No documents found to index.");
            return;
        }

        await si.PUT(documents);
        console.log('Documents indexed successfully.');
    } catch (err) {
        console.error('Error during indexing process:', err);
    }
}

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
    
        // Define your placeholder content
        const placeholderContent = `# New Article\n\nA new article! Time to start typing things up.`;
    
        // Use fs.outputFile to create a new file with placeholder content
        fs.outputFile(fullPath, placeholderContent, err => {
            if (err) {
                console.error('Error creating article:', err);
                socket.emit('articleCreationError', 'Failed to create article');
            } else {
                console.log(`Article created: ${fullPath}`);
                emitFileTree(socket);
            }
        });
    
        indexDocuments();
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

        indexDocuments();
    });

    socket.on('search', async (query) => {
        if (!si) {
            socket.emit('searchError', 'Search index is not ready');
            return;
        }
    
        try {
            const results = await si.QUERY({ AND: query.split(' ') }, { DOCUMENTS: true });
            console.log(results);
            socket.emit('searchResults', results);
        } catch (err) {
            console.error('Search error:', err);
            socket.emit('searchError', 'Error performing search');
        }    
    });    
});


// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

indexDocuments();