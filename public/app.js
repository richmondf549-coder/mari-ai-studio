async function sendMessage() {
    const input = document.getElementById('userInput');
    const chatBox = document.getElementById('chat-box');
    const prompt = input.value.trim();

    if (!prompt) return;

    // Display User Message
    chatBox.innerHTML += `<div class="message"><span class="user">You:</span> ${prompt}</div>`;
    input.value = '';

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
        });

        const data = await response.json();

        // Display Mari AI Response
        if (data.text) {
            chatBox.innerHTML += `<div class="message"><span class="ai">Mari:</span> ${data.text}</div>`;
        } else {
            chatBox.innerHTML += `<div class="message" style="color:red;">Error: ${data.error}</div>`;
        }
        chatBox.scrollTop = chatBox.scrollHeight;
    } catch (err) {
        console.error(err);
    }
}
