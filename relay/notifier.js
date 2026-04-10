async function sendWebhook(url, payload) {
  if (!url) {
    return;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-flint-event": payload.type,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`webhook failed: ${response.status} ${response.statusText}`);
  }
}

module.exports = {
  sendWebhook,
};
