export default function handler(req, res) {
  const baseUrl = process.env.PROCORE_BASE_URL;
  const clientId = process.env.PROCORE_CLIENT_ID;
  const redirectUri = process.env.PROCORE_REDIRECT_URI;

  const authorizeUrl =
    `${baseUrl}/oauth/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;

  res.redirect(authorizeUrl);
}
