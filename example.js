const {
    Client,
    Location,
    Poll,
    List,
    Buttons,
    LocalAuth,
    MessageMedia,
} = require("./index");

const express = require("express");
const bodyParser = require("body-parser");
const sharp = require("sharp");
const { createCanvas, loadImage, registerFont } = require("canvas");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const moment = require("moment");
const { connectDB, getPool } = require("./config/database");
const { exec } = require("child_process");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(bodyParser.json({ limit: "10mb" }));
app.use(express.static("public"));
app.use(express.static(path.join(__dirname, 'media')));

const fontsDir = path.join(__dirname, "fonts");

const fontMap = {
    English: {
        Arimo: { folder: "Arimo", prefix: "Arimo", family: "Arimo" },
        Asimovian: { folder: "Asimovian", prefix: "Asimovian", family: "Asimovian" },
        DM_Sans: { folder: "DM_Sans", prefix: "DM Sans", family: "DM Sans" },
        Epunda_Sans: { folder: "Epunda_Sans", prefix: "Epunda Sans", family: "EpundaSans" },
        Epunda_Slab: { folder: "Epunda_Slab", prefix: "EpundaSlab", family: "EpundaSlab" },
        Jost: { folder: "Jost", prefix: "Jost", family: "Jost" },
        Kode_Mono: { folder: "Kode_Mono", prefix: "Kode Mono", family: "KodeMono" },
        Montserrat: { folder: "Montserrat", prefix: "Montserrat", family: "Montserrat" },
        Noto_Serif: { folder: "Noto_Serif", prefix: "NotoSerif", family: "NotoSerif" },
        Open_Sans: { folder: "Open_Sans", prefix: "OpenSans", family: "OpenSans" },
        Raleway: { folder: "Raleway", prefix: "Raleway", family: "Raleway" },
        Roboto: { folder: "Roboto", prefix: "Roboto", family: "Roboto" },
        Story_Script: { folder: "Story_Script", prefix: "StoryScript", family: "StoryScript" },
        Ubuntu: { folder: "Ubuntu", prefix: "Ubuntu", family: "Ubuntu" },
        Inter: { folder: "Inter", prefix: "Inter", family: "Inter" },
    },
    Gujarati: {
        Anek_Gujarati: { folder: "Anek_Gujarati", prefix: "AnekGujarati", family: "Anek Gujarati" },
    },
    Hindi: {
        Baloo2: { folder: "Baloo2", prefix: "Baloo2", family: "Baloo 2" },
        Hind: { folder: "Hind", prefix: "Hind", family: "Hind" },
    },
    Marathi: {
        Hind: { folder: "Hind", prefix: "Hind", family: "Hind" }, // reuse Hindi Hind
    },
};

// ✅ Common styles by default
const defaultStyles = [
    "Regular",
    "Bold",
    "Italic",
    "BoldItalic",
    "Light",
    "LightItalic",
    "SemiBold",
    "SemiBoldItalic",
];

// ✅ Register fonts
for (const [lang, families] of Object.entries(fontMap)) {
    for (const [key, meta] of Object.entries(families)) {
        const dir = path.join(fontsDir, lang, meta.folder);

        (meta.styles || defaultStyles).forEach((style) => {
            const fileName = `${meta.prefix}-${style}.ttf`; // e.g. DM Sans-Regular.ttf
            const filePath = path.join(dir, fileName);

            if (fs.existsSync(filePath)) {
                const familyName = `${meta.family} ${style.replace(/([A-Z])/g, " $1").trim()}`;
                registerFont(filePath, { family: familyName });
                console.log(`✅ Registered: ${familyName}`);
            } else {
                console.warn(`⚠️ Missing font file: ${filePath}`);
            }
        });
    }
}

app.use("/", express.static(path.join(__dirname, "./media/static")));
app.use("/", express.static(path.join(__dirname, "./media")));
// Optional: Register custom fonts if needed
// registerFont('./fonts/Chrusty Rock d.ttf', { family: 'CustomFont' });

// Load image from a URL as buffer
async function loadImageFromUrl(url) {
    try {
        const response = await axios.get(url, { responseType: "arraybuffer" });
        return Buffer.from(response.data, "binary");
    } catch (error) {
        console.error("Error loading image from URL:", url, error);
        throw error;
    }
}


function getFontString(element) {

    fontName = String(element.fontFamily || "").trim();

    let style = "normal"; // italic / normal
    let weight = "normal"; // bold / 100–900
    let family = fontName;

    // Handle Italic
    if (fontName.toLowerCase().includes("italic")) {
        style = "italic";
        family = family.replace(/italic/i, "").trim();
    }

    // Handle weights
    if (/semibold/i.test(fontName)) {
        weight = "600";
        family = family.replace(/semibold/i, "").trim();
    } else if (/bold/i.test(fontName)) {
        weight = "bold";
        family = family.replace(/bold/i, "").trim();
    } else if (/light/i.test(fontName)) {
        weight = "300";
        family = family.replace(/light/i, "").trim();
    } else if (/regular/i.test(fontName)) {
        weight = "normal";
        family = family.replace(/regular/i, "").trim();
    }

    // Clean up spaces
    family = family.replace(/\s+/g, " ").trim();
    const size = element.size || 24;

    return `${style} ${weight} ${size}px '${family}'`;
}

function wrapTextWithDirection(context, text, x, y, maxWidth, lineHeight, direction = "left", measureOnly = false) {
    const words = text.split(' ');
    let line = '';
    let testLine = '';
    let lineCount = 0;

    for (let n = 0; n < words.length; n++) {
        testLine = line + words[n] + ' ';
        const metrics = context.measureText(testLine);
        const testWidth = metrics.width;

        if (testWidth > maxWidth && n > 0) {
            if (!measureOnly) {
                const drawX = direction === 'right' ? x - context.measureText(line).width : x;
                context.fillText(line, drawX, y);
            }
            line = words[n] + ' ';
            y += lineHeight;
            lineCount++;
        } else {
            line = testLine;
        }
    }

    if (!measureOnly) {
        const drawX = direction === 'right' ? x - context.measureText(line).width : x;
        context.fillText(line, drawX, y);
    }
    return lineCount + 1;
}

const client = new Client({
    authStrategy: new LocalAuth(),
    // proxyAuthentication: { username: 'username', password: 'password' },
    puppeteer: {
        // args: ['--proxy-server=proxy-server-that-requires-authentication.example.com'],
        headless: false,
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    },
});

// client initialize does not finish at ready now.
client.initialize();

app.get("/", (req, res) => {
    res.send("Hello World!");
});

app.get("/send", async (req, res) => {
    try {
        const { mobile, message } = req.query;

        // Validate inputs
        if (!mobile || !message) {
            return res
                .status(400)
                .send("Mobile number and message are required");
        }

        // Format the mobile number correctly
        const formattedMobile = mobile.includes("@c.us")
            ? mobile
            : `${mobile.replace(/[^0-9]/g, "")}@c.us`;

        // Check if user is registered
        const verifyClient = await client.isRegisteredUser(formattedMobile);
        if (!verifyClient) {
            return res.status(200).send("Not Registered To WhatsApp");
        }

        // Send message
        const sendMessageToClient = await client.sendMessage(
            formattedMobile,
            message
        );
        return res.status(200).send(sendMessageToClient);
    } catch (error) {
        console.error("Error sending message:", error);
        return res.status(500).send(error.message || "Internal Server Error");
    }
});

app.get("/send-media", async (req, res) => {
    try {
        const { mobile, filename, caption } = req.query;

        // Validate inputs
        if (!mobile || !filename) {
            return res
                .status(400)
                .send("Mobile number and filename are required");
        }

        // Format the mobile number correctly
        const formattedMobile = mobile.includes("@c.us")
            ? mobile
            : `${mobile.replace(/[^0-9]/g, "")}@c.us`;

        // Check if user is registered
        const isRegistered = await client.isRegisteredUser(formattedMobile);
        if (!isRegistered) {
            return res.status(200).send("Not Registered To WhatsApp");
        }

        // Construct file path
        const filePath = path.join(__dirname, "media", filename);

        // Create media message
        const media = MessageMedia.fromFilePath(filePath);

        // Send media with optional caption
        const options = caption ? { caption: caption } : {};
        const sentMessage = await client.sendMessage(
            formattedMobile,
            media,
            options
        );

        return res.status(200).json({
            status: "success",
            message: "Media sent successfully",
            data: sentMessage,
        });
    } catch (error) {
        console.error("Error sending media:", error);
        return res.status(500).json({
            status: "error",
            message: error.message || "Failed to send media",
        });
    }
});

// FFmpeg configuration
const ffmpegPath = `C:\\Users\\Admin\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-7.1.1-full_build\\bin\\ffmpeg.exe`; // Adjust this path
const mediaDir = path.join(__dirname, "media");
const outputDir = path.join(__dirname, "temp_output");

// Ensure directories exist
[mediaDir, outputDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Modified processVideoWithFrame function to remove white background from frame
async function processVideoWithFrame(videoUrl, frameUrl) {
    try {
        // Ensure directories exist
        if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir);
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

        // Download video and frame
        const [videoResponse, frameResponse] = await Promise.all([
            axios.get(videoUrl, { responseType: 'arraybuffer' }),
            axios.get(frameUrl, { responseType: 'arraybuffer' })
        ]);

        // Save files temporarily
        const videoPath = path.join(mediaDir, `input_video_${Date.now()}.mp4`);
        const framePath = path.join(mediaDir, `frame_${Date.now()}.png`);
        fs.writeFileSync(videoPath, videoResponse.data);
        fs.writeFileSync(framePath, frameResponse.data);

        // Process with FFmpeg - Remove white background and overlay
        const outputPath = path.join(outputDir, `framed_${Date.now()}.mp4`);
        const ffmpegCommand = `${ffmpegPath} -i "${videoPath}" -i "${framePath}" ` +
            `-filter_complex "[1:v]format=rgba[frame];[0:v][frame]overlay=0:0:format=auto" ` +
            `-c:v libx264 -profile:v main -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart -f mp4 "${outputPath}"`;

        await new Promise((resolve, reject) => {
            exec(ffmpegCommand, (error, stdout, stderr) => {
                if (error) {
                    console.error('FFmpeg stderr:', stderr);
                    reject(new Error(`FFmpeg error: ${error.message}`));
                }
                resolve();
            });
        });

        // Verify the output file exists and is not empty
        if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
            throw new Error('FFmpeg failed to produce a valid output file.');
        }

        // Read the processed video
        const processedVideo = fs.readFileSync(outputPath);
        console.log('Processed Video Buffer Size:', processedVideo.length);

        // Cleanup temporary files
        [videoPath, framePath, outputPath].forEach(file => {
            if (fs.existsSync(file)) fs.unlinkSync(file);
        });

        return processedVideo;
    } catch (error) {
        console.error('Video processing error:', error);
        throw error;
    }
}

app.post("/generate-image", async (req, res) => {
    try {
        const { canvas, elements, mobile, caption } = req.body;
        console.log(req.body);

        // Validate input more thoroughly
        if (!canvas || !elements || !Array.isArray(elements) || !mobile) {
            return res.status(400).json({ error: "Invalid request data" });
        }

        // Format mobile number in a more robust way
        const formattedMobile = mobile.includes("@c.us")
            ? mobile
            : `${mobile.replace(/[^0-9]/g, "")}@c.us`;

        // Early exit if user not registered
        const isRegistered = await client.isRegisteredUser(formattedMobile);
        if (!isRegistered) {
            return res.status(200).json({
                status: "error",
                message: "Not Registered To WhatsApp",
            });
        }

        // Check if there's a video element
        const findVideoIndex = elements.findIndex((ele) => ele.src && ele.src.endsWith(".mp4"));

        if (findVideoIndex !== -1) {
            try {
                const videoElement = elements[findVideoIndex];
                const canvasWidth = canvas.width || 800;
                const canvasHeight = canvas.height || 600;
                const canvasInstance = createCanvas(canvasWidth, canvasHeight);
                const ctx = canvasInstance.getContext("2d");

                // Make background transparent for video overlays
                ctx.fillStyle = "rgba(0, 0, 0, 0)";
                ctx.clearRect(0, 0, canvasWidth, canvasHeight);

                // Sort by zIndex (default to 0)
                const sortedElements = elements.sort(
                    (a, b) => (a.zIndex || 0) - (b.zIndex || 0)
                );

                for (const element of sortedElements) {
                    try {
                        if (element === videoElement) continue;

                        if (element.type === "image") {
                            let imgBuffer;

                            if (element.src.startsWith("http")) {
                                imgBuffer = await loadImageFromUrl(element.src);
                            } else if (element.src.startsWith("data:image")) {
                                imgBuffer = Buffer.from(element.src.split(",")[1], "base64");
                            } else {
                                console.warn("Unsupported image source:", element.src);
                                continue;
                            }

                            const imgInstance = await loadImage(imgBuffer);

                            ctx.drawImage(
                                imgInstance,
                                Math.round(element.x),
                                Math.round(element.y),
                                Math.round(element.width),
                                Math.round(element.height)
                            );
                        } else if (element.type === "text") {
                            ctx.fillStyle = element.color || "#000000";
                            ctx.textBaseline = "top";

                            const fontSize = element.size || 24;
                            ctx.font = getFontString(element);
                            const lineHeight = fontSize * 1.2;

                            const content = element.content || "";
                            const lines = content.split("\n"); // support multi-line text

                            const adjustedY = Math.round(element.y - (fontSize * 0.2));

                            // Handle direction + letter spacing
                            for (let li = 0; li < lines.length; li++) {
                                const line = lines[li];

                                // Measure the entire line for width (for text direction)
                                const textMetrics = ctx.measureText(line);
                                let xPos = element.x;

                                // Adjust x position for right-aligned text
                                if (element.textDirection === 'right') {
                                    xPos -= textMetrics.width;
                                }

                                // Render the whole line at once to support complex scripts
                                ctx.fillText(
                                    line,
                                    Math.round(xPos),
                                    adjustedY + li * lineHeight
                                );

                                // Apply letter spacing for subsequent characters if needed
                                if (element.letterSpacing && element.textDirection !== 'right') {
                                    // For left-to-right text with letter spacing, we need to adjust manually
                                    const letters = line.split("");
                                    let currentX = xPos;
                                    for (let i = 0; i < letters.length; i++) {
                                        currentX += ctx.measureText(letters[i]).width + (element.letterSpacing || 0);
                                    }
                                }
                            }
                        }
                    } catch (err) {
                        console.error(`Error rendering ${element.type}:`, err.message);
                    }
                }

                const buffer = canvasInstance.toBuffer("image/png");
                const finalImage = await sharp(buffer, { density: 300 })
                    .ensureAlpha()
                    .png({ compressionLevel: 9, quality: 100 })
                    .toBuffer();

                const outputDir = path.join(__dirname, "media");
                const fileName = `frame-${Date.now()}.png`;
                const outputFile = path.join(outputDir, fileName);

                if (!fs.existsSync(outputDir)) {
                    fs.mkdirSync(outputDir, { recursive: true });
                }

                fs.writeFileSync(outputFile, finalImage);
                console.log(`Frame image saved to ${outputFile}`);

                const frameImageUrl = `http://localhost:8080/${fileName}`;
                const processedVideo = await processVideoWithFrame(videoElement.src, frameImageUrl);

                const media = new MessageMedia(
                    'video/mp4',
                    processedVideo.toString('base64'),
                    'framed-video.mp4'
                );

                // Send only the video with caption
                await client.sendMessage(formattedMobile, media, {
                    caption: caption
                });

                // Clean up files
                fs.unlinkSync(outputFile);

                return res.status(200).json({
                    status: "success",
                    message: "Video sent successfully",
                });
            } catch (videoError) {
                console.error("Error processing video:", videoError);
                return res.status(500).json({
                    status: "error",
                    message: `Video processing failed: ${videoError.message}`,
                });
            }
        }

        // If no video found, proceed with image generation
        const canvasWidth = canvas.width || 800;
        const canvasHeight = canvas.height || 600;
        const canvasInstance = createCanvas(canvasWidth, canvasHeight);
        const ctx = canvasInstance.getContext("2d");

        // Draw background
        ctx.fillStyle = canvas.backgroundColor || "#ffffff";
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        // Sort by zIndex (default to 0)
        const sortedElements = elements.sort(
            (a, b) => (a.zIndex || 0) - (b.zIndex || 0)
        );

        for (const element of sortedElements) {
            try {
                if (element.type === "image") {
                    let imgBuffer;

                    if (element.src.startsWith("http")) {
                        imgBuffer = await loadImageFromUrl(element.src);
                    } else if (element.src.startsWith("data:image")) {
                        imgBuffer = Buffer.from(element.src.split(",")[1], "base64");
                    } else {
                        console.warn("Unsupported image source:", element.src);
                        continue;
                    }

                    const imgInstance = await loadImage(imgBuffer);

                    ctx.drawImage(
                        imgInstance,
                        Math.round(element.x),
                        Math.round(element.y),
                        Math.round(element.width),
                        Math.round(element.height)
                    );
                } else if (element.type === "text") {
                    ctx.fillStyle = element.color || "#000000";
                    ctx.textBaseline = "top";

                    const fontSize = element.size || 24;
                    ctx.font = getFontString(element);
                    const lineHeight = fontSize * 1.2;

                    const content = element.content || "";
                    const lines = content.split("\n"); // support multi-line text

                    const adjustedY = Math.round(element.y);

                    // Handle direction + letter spacing
                    for (let li = 0; li < lines.length; li++) {
                        const line = lines[li];

                        // Measure the entire line for width (for text direction)
                        const textMetrics = ctx.measureText(line);
                        let xPos = element.x;

                        // Adjust x position for right-aligned text
                        if (element.textDirection === 'right') {
                            xPos -= textMetrics.width;
                        }

                        // Render the whole line at once to support complex scripts
                        ctx.fillText(
                            line,
                            Math.round(xPos),
                            adjustedY + li * lineHeight
                        );

                        // Apply letter spacing for subsequent characters if needed
                        if (element.letterSpacing && element.textDirection !== 'right') {
                            // For left-to-right text with letter spacing, we need to adjust manually
                            const letters = line.split("");
                            let currentX = xPos;
                            for (let i = 0; i < letters.length; i++) {
                                currentX += ctx.measureText(letters[i]).width + (element.letterSpacing || 0);
                            }
                        }
                    }
                }
            } catch (err) {
                console.error(`Error rendering ${element.type}:`, err.message);
            }
        }

        // Add watermark to the center of the image
        /* try {
          const watermarkUrl = "https://webtaxfileposter.taxfile.co.in/1721726534457_image_cropper_1721726524492.jpg";
          const watermarkBuffer = await loadImageFromUrl(watermarkUrl);
          const watermarkImage = await loadImage(watermarkBuffer);
    
          // Calculate center position
          const watermarkWidth = canvasWidth * 0.5; // 50% of canvas width (adjust as needed)
          const watermarkHeight = (watermarkImage.height * watermarkWidth) / watermarkImage.width;
    
          const x = (canvasWidth - watermarkWidth) / 2;
          const y = (canvasHeight - watermarkHeight) / 2;
    
          // Draw watermark with reduced opacity
          ctx.globalAlpha = 0.3; // 30% opacity (adjust as needed)
          ctx.drawImage(
            watermarkImage,
            Math.round(x),
            Math.round(y),
            Math.round(watermarkWidth),
            Math.round(watermarkHeight)
          );
          ctx.globalAlpha = 1.0; // Reset opacity
        } catch (err) {
          console.error("Error adding watermark:", err.message);
        } */

        const buffer = canvasInstance.toBuffer("image/png");

        // Optional: Reprocess with sharp for consistent PNG quality
        const finalImage = await sharp(buffer).png({ quality: 100 }).toBuffer();

        // Save to media folder
        const outputDir = path.join(__dirname, "media");
        const fileName = `generated-${Date.now()}.png`;
        const outputFile = path.join(outputDir, fileName);

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        fs.writeFileSync(outputFile, finalImage);
        console.log(`Image saved to ${outputFile}`);

        // Send the image via WhatsApp
        const media = MessageMedia.fromFilePath(outputFile);
        const sentMessage = await client.sendMessage(
            formattedMobile,
            media,
            caption ? { caption } : {}
        );

        // Clean up the file after sending
        try {
            fs.unlinkSync(outputFile);
        } catch (cleanupError) {
            console.error("Error cleaning up file:", cleanupError.message);
        }

        return res.status(200).json({
            status: "success",
            message: "Media sent successfully",
            data: sentMessage?.id, // Only send essential data
        });
    } catch (error) {
        console.error("Error generating media:", error);
        res.status(500).json({
            status: "error",
            error: "Failed to generate media",
            details:
                process.env.NODE_ENV === "development"
                    ? error.message
                    : undefined,
        });
    }
});


client.on("loading_screen", (percent, message) => {
    console.log("LOADING SCREEN", percent, message);
});

// Pairing code only needs to be requested once
let pairingCodeRequested = false;
client.on("qr", async (qr) => {
    // NOTE: This event will not be fired if a session is specified.
    console.log("QR RECEIVED", qr);

    // paiuting code example
    const pairingCodeEnabled = false;
    if (pairingCodeEnabled && !pairingCodeRequested) {
        const pairingCode = await client.requestPairingCode("96170100100"); // enter the target phone number
        console.log("Pairing code enabled, code: " + pairingCode);
        pairingCodeRequested = true;
    }
});

client.on("authenticated", () => {
    console.log("AUTHENTICATED");
});

client.on("auth_failure", (msg) => {
    // Fired if session restore was unsuccessful
    console.error("AUTHENTICATION FAILURE", msg);
});

client.on("ready", async () => {
    console.log("READY");
    const debugWWebVersion = await client.getWWebVersion();
    console.log(`WWebVersion = ${debugWWebVersion}`);

    client.pupPage.on("pageerror", function (err) {
        console.log("Page error: " + err.toString());
    });
    client.pupPage.on("error", function (err) {
        console.log("Page error: " + err.toString());
    });
});

client.on("disconnected", (reason) => {
    console.log("Client was logged out", reason);
});

// Function to check connection status
async function checkWhatsAppConnection() {
    try {
        // Get the current state
        const state = await client.getState();

        if (state === "CONNECTED") {
            console.log("WhatsApp Web is connected");
            pool = await getPool();
            return true;
        } else {
            console.log(
                `WhatsApp Web is not connected. Current state: ${state}`
            );
            return false;
        }
    } catch (error) {
        console.error("Error checking connection status:", error);
        return false;
    }
}

// Use a flag to prevent concurrent executions
let isProcessing = false;

setInterval(async () => {
    if (isProcessing) {
        console.log("Previous cycle still processing, skipping...");
        return;
    }

    isProcessing = true;
    try {
        const isConnected = await checkWhatsAppConnection();
        console.log("Connection status:", isConnected, new Date().toLocaleString());
        if (isConnected) {
            await sentWhatsAppMessage();
        }
    } catch (error) {
        console.error("Error in interval:", error);
    } finally {
        isProcessing = false;
    }
}, 30000); // Check every 30 seconds

const sentWhatsAppMessage = async () => {
    try {
        // Fetch messages with status = 1 and sent_count = 0 to avoid reprocessing
        const listOfMessagesQuery = `
            SELECT wm.id as wm_id, wm.* 
            FROM WhatsUpMessage wm 
            WHERE wm.status = 1 AND wm.deleted = 0
        `;
        const listOfMessages = await pool.query(listOfMessagesQuery);

        if (listOfMessages.recordset.length === 0) {
            console.log("No new messages to send.");
            return;
        }

        for (let i = 0; i < listOfMessages.recordset.length; i++) {
            const message = listOfMessages.recordset[i];

            // Immediately mark the message as being processed to prevent duplicate sends
            const markProcessingQuery = `
                UPDATE WhatsUpMessage 
                SET status = 2, updated_at = GETDATE(), remark = 'Processing'
                WHERE id = ${message.wm_id} AND status = 1
            `;
            const updateResult = await pool.query(markProcessingQuery);

            // If the update affected no rows, the message was already processed by another instance
            if (updateResult.rowsAffected[0] === 0) {
                console.log(`Message ${message.wm_id} already being processed or sent, skipping...`);
                continue;
            }

            try {
                // const fetchUserQuery = `
                //     SELECT * FROM users WHERE id = ${message.user_id}
                // `;
                // console.log('fetchUserQuery', fetchUserQuery);
                // const fetchUser = await pool.query(fetchUserQuery);

                // const filterUserData = fetchUser.recordset.map((obj) => {
                //     const filtered = {};
                //     for (const [key, value] of Object.entries(obj)) {
                //         if (
                //             typeof value === "string" &&
                //             value.length > 0 &&
                //             !["register_mobile", "password", "role"].includes(key)
                //         ) {
                //             filtered[key] = value;
                //         }
                //     }
                //     return filtered;
                // });

                const fetchFrameQuery = `
                     SELECT TOP 1 usf.frame_id as frame_id, usf.frame_json, fc.name as frame_category_name, fsc.name as frame_sub_category_name 
                    FROM user_selection_frame usf
                    LEFT JOIN frame ff ON ff.id = usf.frame_id
                    LEFT JOIN frame_categories fc ON fc.id = ff.frame_categories_id
                    LEFT JOIN frame_sub_categories fsc ON fsc.id = ff.frame_sub_categories_id 
                    WHERE usf.user_id = ${message.user_id} AND usf.status = 1 AND usf.deleted = 0
                    ORDER BY NEWID()
                `;
                // const fetchFrameQuery = `
                //     SELECT fm.id as frame_id, fm.frame_json, fc.name as frame_category_name, 
                //            fsc.name as frame_sub_category_name 
                //     FROM frame fm
                //     LEFT JOIN frame_categories fc ON fc.id = fm.frame_categories_id
                //     LEFT JOIN frame_sub_categories fsc ON fsc.id = fm.frame_sub_categories_id
                //     WHERE fm.id = ${message.frame_id}
                // `;
                console.log('fetchFrameQuery', fetchFrameQuery);
                const fetchFrame = await pool.query(fetchFrameQuery);

                if (fetchFrame.recordset.length === 0) {
                    console.log(`No frame found for user ${message.user_id}`);
                    const updateStatusQuery = `
                        UPDATE WhatsUpMessage 
                        SET status = 0, failed = failed + 1, sent_count = sent_count + 1, 
                            updated_at = GETDATE(), remark = 'No frame found for user'
                        WHERE id = ${message.wm_id}
                    `;
                    await pool.query(updateStatusQuery);
                    continue;
                }

                await sentImagesOnWhatsApp(message, {
                    ...fetchFrame.recordset[0],
                });
            } catch (error) {
                console.error(`Error processing message ${message.wm_id}:`, error);
                const updateStatusQuery = `
                    UPDATE WhatsUpMessage 
                    SET status = 0, failed = failed + 1, sent_count = sent_count + 1, 
                        updated_at = GETDATE(), remark = 'Error: ${error.message.replace(/'/g, "''")}'
                    WHERE id = ${message.wm_id}
                `;
                await pool.query(updateStatusQuery);
            }
        }
    } catch (error) {
        console.error("Error in sentWhatsAppMessage:", error);
    }
};

const sentImagesOnWhatsApp = async (listOfMessages, userData) => {
    console.log("userData", userData);
    console.log("listOfMessages", listOfMessages);
    try {
        const filterUsersFrameKeys = Object.keys(userData).filter(
            (key) =>
                ![
                    "frame_id",
                    "frame_json",
                    "frame_category_name",
                    "frame_sub_category_name",
                ].includes(key)
        );
        filterUsersFrameKeys.push("MainImage", "Frame");

        let jsonData;
        try {
            jsonData = JSON.parse(userData.frame_json);
        } catch (parseError) {
            console.error("Error parsing frame_json:", parseError);
            throw new Error("Invalid frame configuration");
        }

        // jsonData.elements = jsonData.elements.filter((element) =>
        //     filterUsersFrameKeys.includes(element.field)
        // );

        const newJsonDataElements = jsonData.elements.map((item) => {
            // if (item.type === "text") {
            //     return {
            //         ...item,
            //         content: userData[item.field],
            //     };
            // }

            if (item.field === "MainImage") {
                return {
                    ...item,
                    src: listOfMessages["image"],
                };
            }

            // if (item.field === "business_logo" && userData["logo_json"]) {
            //     try {
            //         const parseNewLogoJson = JSON.parse(userData["logo_json"]);
            //         return {
            //             ...item,
            //             ...parseNewLogoJson,
            //             src: `http://localhost:5000/uploads/users/business_logo/${userData["business_logo"]}`,
            //         };
            //     } catch (e) {
            //         console.error("Error processing logo:", e);
            //         return item;
            //     }
            // }

            return item;
        });
        jsonData.elements = newJsonDataElements;

        const json = {
            ...jsonData,
            mobile: `${listOfMessages.WhatsUpSentNumber}`,
            caption: `*${listOfMessages.MediaTitle}*\n\n${moment(listOfMessages.MediaDate).format('LL')}`,
        };

        const { canvas, elements, mobile, caption } = json;

        if (!canvas || !elements || !Array.isArray(elements) || !mobile) {
            throw new Error("Invalid request data");
        }

        const formattedMobile = mobile.includes("@c.us")
            ? mobile
            : `${mobile.replace(/[^0-9]/g, "")}@c.us`;

        const isRegistered = await client.isRegisteredUser(formattedMobile);
        if (!isRegistered) {
            const updateStatusQuery = `
                UPDATE WhatsUpMessage 
                SET status = 0, failed = failed + 1, sent_count = sent_count + 1, 
                    updated_at = GETDATE(), remark = 'Not Registered To WhatsApp'
                WHERE id = ${listOfMessages.wm_id}
            `;
            await pool.query(updateStatusQuery);
            return;
        }

        // Check if there's a video element
        const findVideoIndex = elements.findIndex((ele) => ele.src && ele.src.endsWith(".mp4"));

        if (findVideoIndex !== -1) {
            try {
                const videoElement = elements[findVideoIndex];
                const canvasWidth = canvas.width || 800;
                const canvasHeight = canvas.height || 600;
                const canvasInstance = createCanvas(canvasWidth, canvasHeight);
                const ctx = canvasInstance.getContext("2d");

                // Make background transparent for video overlays
                ctx.fillStyle = "rgba(0, 0, 0, 0)";
                ctx.clearRect(0, 0, canvasWidth, canvasHeight);

                // Sort by zIndex (default to 0)
                const sortedElements = elements.sort(
                    (a, b) => (a.zIndex || 0) - (b.zIndex || 0)
                );

                for (const element of sortedElements) {
                    try {
                        if (element === videoElement) continue;

                        if (element.type === "image") {
                            let imgBuffer;

                            if (element.src.startsWith("http")) {
                                imgBuffer = await loadImageFromUrl(element.src);
                            } else if (element.src.startsWith("data:image")) {
                                imgBuffer = Buffer.from(element.src.split(",")[1], "base64");
                            } else {
                                console.warn("Unsupported image source:", element.src);
                                continue;
                            }

                            const imgInstance = await loadImage(imgBuffer);

                            ctx.drawImage(
                                imgInstance,
                                Math.round(element.x),
                                Math.round(element.y),
                                Math.round(element.width),
                                Math.round(element.height)
                            );
                        } else if (element.type === "text") {
                            ctx.fillStyle = element.color || "#000000";
                            ctx.textBaseline = "top";

                            const fontSize = element.size || 24;
                            ctx.font = getFontString(element);
                            const lineHeight = fontSize * 1.2;

                            const content = element.content || "";
                            const lines = content.split("\n"); // support multi-line text

                            const adjustedY = Math.round(element.y - (fontSize * 0.2));

                            // Handle direction + letter spacing
                            for (let li = 0; li < lines.length; li++) {
                                const line = lines[li];

                                // Measure the entire line for width (for text direction)
                                const textMetrics = ctx.measureText(line);
                                let xPos = element.x;

                                // Adjust x position for right-aligned text
                                if (element.textDirection === 'right') {
                                    xPos -= textMetrics.width;
                                }

                                // Render the whole line at once to support complex scripts
                                ctx.fillText(
                                    line,
                                    Math.round(xPos),
                                    adjustedY + li * lineHeight
                                );

                                // Apply letter spacing for subsequent characters if needed
                                if (element.letterSpacing && element.textDirection !== 'right') {
                                    // For left-to-right text with letter spacing, we need to adjust manually
                                    const letters = line.split("");
                                    let currentX = xPos;
                                    for (let i = 0; i < letters.length; i++) {
                                        currentX += ctx.measureText(letters[i]).width + (element.letterSpacing || 0);
                                    }
                                }
                            }
                        }
                    } catch (err) {
                        console.error(`Error rendering ${element.type}:`, err.message);
                    }
                }

                const buffer = canvasInstance.toBuffer("image/png");
                const finalImage = await sharp(buffer, { density: 300 })
                    .ensureAlpha()
                    .png({ compressionLevel: 9, quality: 100 })
                    .toBuffer();

                const outputDir = path.join(__dirname, "media");
                const fileName = `frame-${Date.now()}.png`;
                const outputFile = path.join(outputDir, fileName);

                if (!fs.existsSync(outputDir)) {
                    fs.mkdirSync(outputDir, { recursive: true });
                }

                fs.writeFileSync(outputFile, finalImage);
                console.log(`Frame image saved to ${outputFile}`);

                const frameImageUrl = `http://localhost:8080/${fileName}`;
                const processedVideo = await processVideoWithFrame(videoElement.src, frameImageUrl);

                const media = new MessageMedia(
                    'video/mp4',
                    processedVideo.toString('base64'),
                    'framed-video.mp4'
                );

                // Send only the video with caption
                await client.sendMessage(formattedMobile, media, {
                    caption: caption
                });

                // Clean up files
                fs.unlinkSync(outputFile);

                const updateStatusQuery = `
                    UPDATE WhatsUpMessage 
                    SET status = 0, sent_count = sent_count + 1, 
                        updated_at = GETDATE(), remark = 'Video Sent Successfully!'
                    WHERE id = ${listOfMessages.wm_id}
                `;
                await pool.query(updateStatusQuery);

                return;

                // return res.status(200).json({
                //     status: "success",
                //     message: "Video sent successfully",
                // });
            } catch (videoError) {
                console.error("Error processing video:", videoError);
                return res.status(500).json({
                    status: "error",
                    message: `Video processing failed: ${videoError.message}`,
                });
            }
        }

        // If no video found, proceed with image generation
        const canvasWidth = canvas.width || 800;
        const canvasHeight = canvas.height || 600;
        const canvasInstance = createCanvas(canvasWidth, canvasHeight);
        const ctx = canvasInstance.getContext("2d");

        // Draw background
        ctx.fillStyle = canvas.backgroundColor || "#ffffff";
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        // Sort by zIndex (default to 0)
        const sortedElements = elements.sort(
            (a, b) => (a.zIndex || 0) - (b.zIndex || 0)
        );

        for (const element of sortedElements) {
            try {
                if (element.type === "image") {
                    let imgBuffer;

                    if (element.src.startsWith("http")) {
                        imgBuffer = await loadImageFromUrl(element.src);
                    } else if (element.src.startsWith("data:image")) {
                        imgBuffer = Buffer.from(element.src.split(",")[1], "base64");
                    } else {
                        console.warn("Unsupported image source:", element.src);
                        continue;
                    }

                    const imgInstance = await loadImage(imgBuffer);

                    ctx.drawImage(
                        imgInstance,
                        Math.round(element.x),
                        Math.round(element.y),
                        Math.round(element.width),
                        Math.round(element.height)
                    );
                } else if (element.type === "text") {
                    ctx.fillStyle = element.color || "#000000";
                    ctx.textBaseline = "top";

                    const fontSize = element.size || 24;
                    ctx.font = getFontString(element);
                    const lineHeight = fontSize * 1.2;

                    const content = element.content || "";
                    const lines = content.split("\n"); // support multi-line text

                    const adjustedY = Math.round(element.y);

                    // Handle direction + letter spacing
                    for (let li = 0; li < lines.length; li++) {
                        const line = lines[li];

                        // Measure the entire line for width (for text direction)
                        const textMetrics = ctx.measureText(line);
                        let xPos = element.x;

                        // Adjust x position for right-aligned text
                        if (element.textDirection === 'right') {
                            xPos -= textMetrics.width;
                        }

                        // Render the whole line at once to support complex scripts
                        ctx.fillText(
                            line,
                            Math.round(xPos),
                            adjustedY + li * lineHeight
                        );

                        // Apply letter spacing for subsequent characters if needed
                        if (element.letterSpacing && element.textDirection !== 'right') {
                            // For left-to-right text with letter spacing, we need to adjust manually
                            const letters = line.split("");
                            let currentX = xPos;
                            for (let i = 0; i < letters.length; i++) {
                                currentX += ctx.measureText(letters[i]).width + (element.letterSpacing || 0);
                            }
                        }
                    }
                }
            } catch (err) {
                console.error(`Error rendering ${element.type}:`, err.message);
            }
        }

        // Add watermark to the center of the image
        /* try {
          const watermarkUrl = "https://webtaxfileposter.taxfile.co.in/1721726534457_image_cropper_1721726524492.jpg";
          const watermarkBuffer = await loadImageFromUrl(watermarkUrl);
          const watermarkImage = await loadImage(watermarkBuffer);
    
          // Calculate center position
          const watermarkWidth = canvasWidth * 0.5; // 50% of canvas width (adjust as needed)
          const watermarkHeight = (watermarkImage.height * watermarkWidth) / watermarkImage.width;
    
          const x = (canvasWidth - watermarkWidth) / 2;
          const y = (canvasHeight - watermarkHeight) / 2;
    
          // Draw watermark with reduced opacity
          ctx.globalAlpha = 0.3; // 30% opacity (adjust as needed)
          ctx.drawImage(
            watermarkImage,
            Math.round(x),
            Math.round(y),
            Math.round(watermarkWidth),
            Math.round(watermarkHeight)
          );
          ctx.globalAlpha = 1.0; // Reset opacity
        } catch (err) {
          console.error("Error adding watermark:", err.message);
        } */

        const buffer = canvasInstance.toBuffer("image/png");

        // Optional: Reprocess with sharp for consistent PNG quality
        const finalImage = await sharp(buffer).png({ quality: 100 }).toBuffer();

        // Save to media folder
        const outputDir = path.join(__dirname, "media");
        const fileName = `generated-${Date.now()}.png`;
        const outputFile = path.join(outputDir, fileName);

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        fs.writeFileSync(outputFile, finalImage);
        console.log(`Image saved to ${outputFile}`);

        // Send the image via WhatsApp
        const media = MessageMedia.fromFilePath(outputFile);
        const sentMessage = await client.sendMessage(
            formattedMobile,
            media,
            caption ? { caption } : {}
        );

        // Clean up the file after sending
        try {
            fs.unlinkSync(outputFile);
        } catch (cleanupError) {
            console.error("Error cleaning up file:", cleanupError.message);
        }

        const updateStatusQuery = `
            UPDATE WhatsUpMessage 
            SET status = 0, sent_count = sent_count + 1, 
                updated_at = GETDATE(), remark = 'Sent Successfully!'
            WHERE id = ${listOfMessages.wm_id}
        `;
        await pool.query(updateStatusQuery);
    } catch (error) {
        console.error("Error generating media:", error);
        const updateStatusQuery = `
            UPDATE WhatsUpMessage 
            SET status = 0, sent_count = sent_count + 1, failed = failed + 1, 
                updated_at = GETDATE(), remark = 'Error: ${error?.message?.replace(/'/g, "''") || "Unknown Error"}'
            WHERE id = ${listOfMessages.wm_id}
        `;
        await pool.query(updateStatusQuery);
    }
};

// Start server
const startServer = async () => {
    try {
        await connectDB();
        const PORT = process.env.PORT || 8080;
        app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
            console.log(
                `Environment: ${process.env.NODE_ENV || "development"}`
            );
        });
    } catch (error) {
        console.error("Failed to start server:", error);
        process.exit(1);
    }
};

startServer();