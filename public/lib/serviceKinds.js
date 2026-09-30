// Credential requirements per service type, shared by the server (config.js)
// and the browser/native local mode (connections, localBackend, fallbackSync)
// so every layer agrees on what "configured" means.
//
//   api-key        : an API key is required (the default)
//   optional-key   : works without a key; send one if the service has auth on (Tdarr)
//   none           : the service has no API auth at all (Maintainerr)
//   password       : password only (Deluge Web)
//   basic          : username + password required (NZBGet, Flood)
//   optional-basic : username + password optional, but both or neither (Transmission)
const REQUIREMENTS = {
  maintainerr: 'none',
  tdarr: 'optional-key',
  deluge: 'password',
  nzbget: 'basic',
  flood: 'basic',
  transmission: 'optional-basic',
};

export function credentialRequirement(type) {
  return REQUIREMENTS[type] || 'api-key';
}

// True when the credentials present satisfy the type's requirement.
export function hasRequiredCredentials(type, { apiKey, username, password } = {}) {
  switch (credentialRequirement(type)) {
    case 'none':
    case 'optional-key': return true;
    case 'password': return !!password;
    case 'basic': return !!(username && password);
    case 'optional-basic': return !!username === !!password;
    default: return !!apiKey;
  }
}

// Types whose credentials are a login (username/password), not an API key.
export function usesLoginCredentials(type) {
  return ['password', 'basic', 'optional-basic'].includes(credentialRequirement(type));
}
