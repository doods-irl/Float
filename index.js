const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");
const dirTree = require("directory-tree");
const searchIndex = require('search-index');

const contentPath = path.join(__dirname, 'content');
const templatePath = path.join(__dirname, 'templates');
const deletedPath = path.join(__dirname, 'deleted');

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

function emitDeletedFileTree(socket) {
    try {
        const tree = dirTree(deletedPath, {attributes: ['type'], extensions: /\.md/ });
        socket.emit('fileTree', tree);
    } catch (error) {
        console.error('Error reading file tree:', error);
        socket.emit('fileTreeError', 'Failed to read file tree');
    }
}

function emitTemplateFileTree(socket) {
    try {
        const tree = dirTree(templatePath, {attributes: ['type'], extensions: /\.md/ });
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
                    emitFileTree(socket);
                    socket.emit('returnNewArticle', filePath);
                    indexDocuments();
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
            socket.emit('returnNewArticle', filePath);
        }
    });

    socket.on('createTemplate', (filePath) => {
        const fullPath = path.join(templatePath, filePath);
        
        // Function to create file with given content
        const createFile = (content) => {
            fs.outputFile(fullPath, content, err => {
                if (err) {
                    console.error('Error creating article:', err);
                    socket.emit('articleCreationError', 'Failed to create article');
                } else {
                    console.log(`Article created: ${fullPath}`);
                    emitTemplateFileTree(socket);
                    socket.emit('returnNewArticle', filePath);
                    indexDocuments();
                }
            });
        };
    
        // Default placeholder content
        const defaultContent = `# New Article\n\nA new article! Time to start typing things up.`;
        createFile(defaultContent);
        socket.emit('returnNewArticle', filePath);
    });

    socket.on('saveFileContent', (data) => {
        var fullPath = path.join(contentPath, data.filePath);
        const nameCheck = data.submittedFileName + '.md';
        
        // Write file content first
        fs.writeFile(fullPath, data.content, 'utf8', err => {
            if (err) {
                console.error('Error writing file:', err);
                socket.emit('saveFileContentError', 'Failed to save file');
            } else {
                console.log(`File saved: ${fullPath}`);
                
                // Check if renaming is required
                if (data.name !== nameCheck) {
                    const newPath = fullPath.replace(data.name, nameCheck);
                    fs.rename(fullPath, newPath, renameErr => {
                        if (renameErr) {
                            console.error('Error renaming file:', renameErr);
                            socket.emit('saveFileContentError', 'Failed to rename file');
                        } else {
                            console.log(`File renamed: ${newPath}`);
                            const fileName = path.basename(newPath);
                            emitFileTree(socket);
                            socket.emit('saveFileContentSuccess', { path: fileName });
                        }
                    });
                } else {
                    socket.emit('saveFileContentSuccess', 'File saved successfully');
                }
            }
        });
        indexDocuments();
    });

    socket.on('saveTemplateContent', (data) => {
        var fullPath = path.join(templatePath, data.filePath);
        const nameCheck = data.submittedFileName + '.md';
        
        // Write file content first
        fs.writeFile(fullPath, data.content, 'utf8', err => {
            if (err) {
                console.error('Error writing file:', err);
                socket.emit('saveFileContentError', 'Failed to save file');
            } else {
                console.log(`File saved: ${fullPath}`);
                
                // Check if renaming is required
                if (data.name !== nameCheck) {
                    const newPath = fullPath.replace(data.name, nameCheck);
                    fs.rename(fullPath, newPath, renameErr => {
                        if (renameErr) {
                            console.error('Error renaming file:', renameErr);
                            socket.emit('saveFileContentError', 'Failed to rename file');
                        } else {
                            console.log(`File renamed: ${newPath}`);
                            const fileName = path.basename(newPath);
                            emitFileTree(socket);
                            socket.emit('saveFileContentSuccess', { path: fileName });
                        }
                    });
                } else {
                    socket.emit('saveFileContentSuccess', 'File saved successfully');
                }
            }
        });
    });

    socket.on('saveTemplate', (data) => {
        const templatesDir = path.join(__dirname, 'templates');
        const fullPath = path.join(templatesDir, data.filePath );
        
        fs.writeFile(fullPath, data.content, 'utf8', err => {
            if (err) {
                console.error('Error writing template:', err);
                socket.emit('saveFileContentError', 'Failed to save template');
            } else {
                console.log(`Template saved: ${fullPath}`);
                socket.emit('saveFileContentSuccess', 'Template saved successfully');
            }
        });
    });

    socket.on('deleteFile', (data) => {
        const fullPath = path.join(contentPath, data); // Ensure data.filePath is defined
        const deletedDir = path.join(__dirname, 'deleted', path.dirname(data)); // Create corresponding directory structure in 'deleted'
    
        // Create the necessary subdirectories in the 'deleted' directory
        fs.mkdir(deletedDir, { recursive: true }, (err) => {
            if (err) {
                console.error('Error creating directory:', err);
                return;
            }
    
            const deletedFilePath = path.join(deletedDir, path.basename(data));
    
            // Move the file to the new location in the 'deleted' directory
            fs.rename(fullPath, deletedFilePath, (err) => {
                if (err) {
                    console.error('Error moving file:', err);
                    // Emit an error response or handle it as needed
                } else {
                    console.log(`File moved to 'deleted': ${deletedFilePath}`);
                    emitFileTree(socket);
                    indexDocuments();
                }
            });
        });
    });

    socket.on('deleteFolder', (data) => {
        const fullPath = path.join(contentPath, data); // Ensure data.filePath is defined
    
        // Delete the file directly
        fs.rmdir(fullPath, (err) => {
            if (err) {
                console.error('Error deleting file:', err);
                // Emit an error response or handle it as needed
                socket.emit('deleteTemplateFileError', 'Failed to delete file');
            } else {
                console.log(`File deleted: ${fullPath}`);
                // Emit success response or perform further actions
                socket.emit('deleteTemplateFileSuccess', 'File deleted successfully');
                emitFileTree(socket);
                indexDocuments();
            }
        });
    });

    socket.on('deleteTemplateFile', (data) => {
        const fullPath = path.join(templatePath, data); // Ensure data.filePath is defined
    
        // Delete the file directly
        fs.unlink(fullPath, (err) => {
            if (err) {
                console.error('Error deleting file:', err);
                // Emit an error response or handle it as needed
                socket.emit('deleteTemplateFileError', 'Failed to delete file');
            } else {
                console.log(`File deleted: ${fullPath}`);
                // Emit success response or perform further actions
                socket.emit('deleteTemplateFileSuccess', 'File deleted successfully');
                emitTemplateFileTree(socket);
                indexDocuments();
            }
        });
    });

    socket.on('restoreFile', (data) => {
        const fullPath = path.join(deletedPath, data); // Path of the file in the 'deleted' directory
        const contentDir = path.join(__dirname, 'content', path.dirname(data)); // Target directory in 'content'
    
        // Create the necessary subdirectories in the 'content' directory
        fs.mkdir(contentDir, { recursive: true }, (err) => {
            if (err) {
                console.error('Error creating directory:', err);
                return;
            }
    
            const restoredFilePath = path.join(contentDir, path.basename(data));
    
            // Move the file to the new location in the 'content' directory
            fs.rename(fullPath, restoredFilePath, (err) => {
                if (err) {
                    console.error('Error moving file:', err);
                    // Emit an error response or handle it as needed
                } else {
                    console.log(`File restored: ${restoredFilePath}`);
                    indexDocuments();
                    emitDeletedFileTree(socket);
    
                    // Check if the original folder is empty
                    const originalDir = path.dirname(fullPath);
                    if (originalDir !== deletedPath) { // Ensure we're not trying to delete the 'deletedPath' itself
                        fs.readdir(originalDir, (err, files) => {
                            if (err) {
                                console.error('Error reading directory:', err);
                                return;
                            }
    
                            if (files.length === 0) {
                                // If the folder is empty, delete it
                                fs.rmdir(originalDir, (err) => {
                                    if (err) {
                                        console.error('Error removing directory:', err);
                                    } else {
                                        console.log(`Deleted empty directory: ${originalDir}`);
                                        emitDeletedFileTree(socket);
                                    }
                                });
                            }
                        });
                    }
                }
            });
        });
    });
    
    socket.on('requestFiles', () => {
        emitFileTree(socket);
    });

    socket.on('requestDeletedFiles', () => {
        emitDeletedFileTree(socket);
    });

    socket.on('requestTemplateFiles', () => {
        emitTemplateFileTree(socket);
    });

    socket.on('requestDeletedFileContent', (filePath) => {
        const fullPath = path.join(deletedPath, filePath);
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

    socket.on('requestTemplateFileContent', (filePath) => {
        const fullPath = path.join(templatePath, filePath);
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