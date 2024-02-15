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
                // Extract the filename from the fullPath
                const fileName = path.basename(fullPath);

                // Send both the file content and the filename
                socket.emit('fileContent', { content: data, fileName: fileName });
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

    socket.on('createArticle', (filePath, fromTemplate) => {
        const fullPath = path.join(contentPath, filePath);
        const templatesDir = path.join(__dirname, 'templates');
        
        // Function to create file with given content
        const createFile = (content) => {
            fs.outputFile(fullPath, content, err => {
                if (err) {
                    console.error('Error creating article:', err);
                    socket.emit('articleCreationError', 'Failed to create article');
                } else {
                    console.log(`Article created: ${fullPath}`);
                    emitFileTree(socket); // Assuming this function updates the client with the new file structure
                    indexDocuments(); // Assuming this function indexes the new documents
                }
            });
        };
    
        // Check if a template is specified
        if (fromTemplate) {
            const templatePath = path.join(templatesDir, fromTemplate);
            fs.readFile(templatePath, 'utf8', (err, data) => {
                if (err) {
                    console.error('Error reading template:', err);
                    socket.emit('articleCreationError', 'Failed to read template');
                } else {
                    createFile(data);
                }
            });
        } else {
            // Default placeholder content
            const defaultContent = `# New Article\n\nA new article! Time to start typing things up.`;
            createFile(defaultContent);
        }
        socket.emit('returnNewArticle', filePath);
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
            socket.emit('searchResults', results);
        } catch (err) {
            console.error('Search error:', err);
            socket.emit('searchError', 'Error performing search');
        }    
    });

    socket.on('getTemplates', () => {
        const templatesDir = path.join(__dirname, 'templates'); // 'templates' is the folder in your root directory

        fs.readdir(templatesDir, (err, files) => {
            if (err) {
                console.error('Error reading templates directory:', err);
                return;
            }

            const mdFiles = files.filter(file => file.endsWith('.md'));
            socket.emit('receiveTemplates', mdFiles);
        });
    });
});


// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

indexDocuments();