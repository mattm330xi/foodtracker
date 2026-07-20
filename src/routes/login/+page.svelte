<script lang="ts">
  import { goto } from '$app/navigation';

  let mode: 'login' | 'register' = $state('login');
  let username = $state('');
  let loading = $state(false);
  let error = $state('');
  let step: 'idle' | 'working' = $state('idle');

  function bufToBase64url(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64urlToBuf(str: string): ArrayBuffer {
    const padded = str.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    const binary = atob(padded + pad);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  async function handleRegister() {
    error = '';
    loading = true;
    step = 'working';

    try {
      const startRes = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'register-start', username }),
      });
      const startData = await startRes.json();
      if (startData.error) { error = startData.error; loading = false; step = 'idle'; return; }

      const opts = startData.options;
      const createOptions: CredentialCreationOptions = {
        publicKey: {
          rp: opts.rp,
          user: {
            id: base64urlToBuf(opts.user.id),
            name: opts.user.name,
            displayName: opts.user.displayName,
          },
          challenge: base64urlToBuf(opts.challenge),
          pubKeyCredParams: opts.pubKeyCredParams,
          authenticatorSelection: opts.authenticatorSelection,
          timeout: opts.timeout,
          attestation: opts.attestation,
        }
      };

      const credential = await navigator.credentials.create(createOptions) as PublicKeyCredential;
      const raw = credential.rawId;
      const response = credential.response as AuthenticatorAttestationResponse;

      const body = {
        id: credential.id,
        rawId: bufToBase64url(raw),
        type: credential.type,
        response: {
          clientDataJSON: bufToBase64url(response.clientDataJSON),
          attestationObject: bufToBase64url(response.attestationObject),
          getAuthenticatorData: () => bufToBase64url(response.getAuthenticatorData()),
          getPublicKey: () => response.getPublicKey() ? bufToBase64url(response.getPublicKey()!) : null,
          getPublicKeyAlgorithm: () => response.getPublicKeyAlgorithm(),
          getTransports: () => response.getTransports(),
        },
      };

      const finishRes = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'register-finish', credential }),
      });
      const finishData = await finishRes.json();
      if (finishData.error) { error = finishData.error; loading = false; step = 'idle'; return; }

      goto('/');
    } catch (e: any) {
      error = e?.name === 'NotAllowedError' ? 'Passkey creation was cancelled' : e?.message || 'Failed';
      loading = false;
      step = 'idle';
    }
  }

  async function handleLogin() {
    error = '';
    loading = true;
    step = 'working';

    try {
      const startRes = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login-start', username }),
      });
      const startData = await startRes.json();
      if (startData.error) { error = startData.error; loading = false; step = 'idle'; return; }

      const opts = startData.options;
      const getOptions: CredentialRequestOptions = {
        publicKey: {
          challenge: base64urlToBuf(opts.challenge),
          rpId: opts.rpId,
          allowCredentials: opts.allowCredentials?.map((c: any) => ({
            id: base64urlToBuf(c.id),
            type: 'public-key' as PublicKeyCredentialType,
            transports: c.transports as AuthenticatorTransport[],
          })),
          userVerification: opts.userVerification,
          timeout: opts.timeout,
        }
      };

      const credential = await navigator.credentials.get(getOptions) as PublicKeyCredential;
      const response = credential.response as AuthenticatorAssertionResponse;

      const body = {
        id: credential.id,
        rawId: bufToBase64url(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: bufToBase64url(response.clientDataJSON),
          authenticatorData: bufToBase64url(response.authenticatorData),
          signature: bufToBase64url(response.signature),
          userHandle: response.userHandle ? bufToBase64url(response.userHandle) : null,
        },
      };

      const finishRes = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'login-finish',
          credential: body,
          userId: startData.userId,
          challenge: startData._debug.challenge,
        }),
      });
      const finishData = await finishRes.json();
      if (finishData.error) { error = finishData.error; loading = false; step = 'idle'; return; }

      goto('/');
    } catch (e: any) {
      error = e?.name === 'NotAllowedError' ? 'Passkey authentication was cancelled' : e?.message || 'Failed';
      loading = false;
      step = 'idle';
    }
  }

  function submit(e: Event) {
    e.preventDefault();
    if (!username.trim()) return;
    if (mode === 'register') handleRegister();
    else handleLogin();
  }
</script>

<svelte:head><title>Sign In - Food Tracker</title></svelte:head>

<main>
  <div class="login-card">
    <div class="logo">🍽️</div>
    <h1>Food Tracker</h1>
    <p class="subtitle">Sign in with a passkey</p>

    {#if error}
      <div class="error">{error}</div>
    {/if}

    {#if step === 'working'}
      <div class="step-msg">
        <div class="spinner"></div>
        <p>Waiting for device...</p>
        <p class="step-hint">Use Touch ID, Face ID, or your security key</p>
        <button class="cancel" onclick={() => { loading = false; step = 'idle'; error = ''; }}>Cancel</button>
      </div>
    {:else}
      <form onsubmit={submit}>
        <input
          bind:value={username}
          placeholder="Username"
          autocomplete="username webauthn"
          class="input"
          disabled={loading}
        />
        <button type="submit" class="submit" disabled={loading || !username.trim()}>
          {mode === 'register' ? 'Create Passkey' : 'Sign In'}
        </button>
      </form>

      <button class="toggle" onclick={() => { mode = mode === 'login' ? 'register' : 'login'; error = ''; }}>
        {mode === 'login' ? "Don't have an account? Register" : 'Already have an account? Sign in'}
      </button>
    {/if}
  </div>
</main>

<style>
  main { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 16px; background: #f5f5f5; }
  .login-card { background: #fff; border-radius: 16px; padding: 32px 24px; width: 100%; max-width: 340px; box-shadow: 0 4px 24px rgba(0,0,0,0.1); text-align: center; }
  .logo { font-size: 48px; margin-bottom: 8px; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  .subtitle { margin: 0 0 20px; color: #888; font-size: 14px; }
  .error { background: #fff5f5; border: 1px solid #ffcdd2; color: #c00; padding: 8px 12px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; }
  .input { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 10px; font-size: 16px; margin-bottom: 12px; box-sizing: border-box; text-align: center; font-family: inherit; }
  .input:focus { outline: none; border-color: #4CAF50; }
  .submit { width: 100%; padding: 12px; background: #4CAF50; color: #fff; border: none; border-radius: 10px; font-size: 16px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .submit:disabled { opacity: 0.5; cursor: not-allowed; }
  .submit:hover:not(:disabled) { background: #388E3C; }
  .toggle { background: none; border: none; color: #4CAF50; font-size: 13px; cursor: pointer; margin-top: 16px; padding: 0; font-family: inherit; }
  .toggle:hover { text-decoration: underline; }
  .step-msg { padding: 20px 0; }
  .step-msg p { margin: 8px 0 0; font-size: 15px; }
  .step-hint { color: #888; font-size: 13px !important; }
  .cancel { margin-top: 12px; background: none; border: 1px solid #ddd; color: #888; padding: 6px 16px; border-radius: 8px; font-size: 13px; cursor: pointer; font-family: inherit; }
  .spinner { width: 32px; height: 32px; border: 3px solid #eee; border-top-color: #4CAF50; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
