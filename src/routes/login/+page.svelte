<script lang="ts">
  import { goto } from '$app/navigation';

  let mode: 'login' | 'register' = $state('login');
  let authMethod: 'passkey' | 'password' = $state('passkey');
  let username = $state('');
  let password = $state('');
  let confirmPassword = $state('');
  let loading = $state(false);
  let error = $state('');
  let step: 'idle' | 'working' = $state('idle');
  let confirmMessage = $state('');
  let pendingPassword = $state('');

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

  // ─── Passkey registration ─────────────────────────────────

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
          transports: response.getTransports?.() ?? [],
        },
      };

      const finishRes = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'register-finish', credential: body }),
      });
      const finishData = await finishRes.json();
      if (finishData.error) { error = finishData.error; loading = false; step = 'idle'; return; }

      goto('/');
    } catch (e: any) {
      error = e?.name === 'NotAllowedError' ? 'Sign-in was cancelled' : e?.message || 'Failed';
      loading = false;
      step = 'idle';
    }
  }

  // ─── Passkey login ────────────────────────────────────────

  async function handleLogin() {
    error = '';
    confirmMessage = '';
    loading = true;
    step = 'working';

    try {
      const startRes = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login-start', username }),
      });
      const startData = await startRes.json();

      if (startData.confirmWithPassword) {
        loading = false;
        step = 'idle';
        authMethod = 'password';
        confirmMessage = 'Enter your password to add Face ID or Touch ID to this account.';
        return;
      }

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
        body: JSON.stringify({ action: 'login-finish', credential: body, userId: startData.userId }),
      });
      const finishData = await finishRes.json();
      if (finishData.error) { error = finishData.error; loading = false; step = 'idle'; return; }

      goto('/');
    } catch (e: any) {
      error = e?.name === 'NotAllowedError' ? 'Sign-in was cancelled' : e?.message || 'Failed';
      loading = false;
      step = 'idle';
    }
  }

  // ─── Password registration ────────────────────────────────

  async function handleRegisterPassword() {
    error = '';
    if (password !== confirmPassword) { error = 'Passwords do not match'; return; }
    if (password.length < 8) { error = 'Password must be at least 8 characters'; return; }
    loading = true;
    step = 'working';

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'register-password', username, password }),
      });
      const data = await res.json();
      if (data.error) { error = data.error; loading = false; step = 'idle'; return; }
      goto('/');
    } catch (e: any) {
      error = e?.message || 'Failed';
      loading = false;
      step = 'idle';
    }
  }

  // ─── Password login (+ cross-method flow) ─────────────────

  async function handleLoginPassword() {
    error = '';
    confirmMessage = '';
    loading = true;
    step = 'working';

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login-password', username, password }),
      });
      const data = await res.json();

      if (data.confirmWithPasskey) {
        pendingPassword = password;
        password = '';
        loading = true;
        step = 'working';
        confirmMessage = 'Use your Face ID or Touch ID to add password access.';
        await finishPasskeyAfterPasswordConfirm();
        return;
      }

      if (data.error) { error = data.error; loading = false; step = 'idle'; return; }
      if (data.needsPasskey) {
        goto('/profile?highlight=passkey');
        return;
      }
      goto('/');
    } catch (e: any) {
      error = e?.name === 'NotAllowedError' ? 'Sign-in was cancelled' : e?.message || 'Failed';
      loading = false;
      step = 'idle';
    }
  }

  // ─── Cross-method: passkey confirm → set password ─────────

  async function finishPasskeyAfterPasswordConfirm() {
    try {
      const startRes = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login-start', username }),
      });
      const startData = await startRes.json();
      if (startData.error) { error = startData.error; loading = false; step = 'idle'; pendingPassword = ''; return; }

      const opts = startData.options;
      const credential = await navigator.credentials.get({
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
      }) as PublicKeyCredential;
      const response = credential.response as AuthenticatorAssertionResponse;

      const finishRes = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'login-finish',
          credential: {
            id: credential.id,
            rawId: bufToBase64url(credential.rawId),
            type: credential.type,
            response: {
              clientDataJSON: bufToBase64url(response.clientDataJSON),
              authenticatorData: bufToBase64url(response.authenticatorData),
              signature: bufToBase64url(response.signature),
              userHandle: response.userHandle ? bufToBase64url(response.userHandle) : null,
            },
          },
          userId: startData.userId,
        }),
      });
      const finishData = await finishRes.json();
      if (finishData.error) { error = finishData.error; loading = false; step = 'idle'; pendingPassword = ''; return; }

      const setPasswordRes = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-password', password: pendingPassword }),
      });
      const setPasswordData = await setPasswordRes.json();
      pendingPassword = '';

      if (setPasswordData.error) {
        error = 'Signed in but failed to set password. You can set it from Settings.';
        loading = false;
        step = 'idle';
        return;
      }

      goto('/');
    } catch (e: any) {
      error = e?.name === 'NotAllowedError' ? 'Sign-in was cancelled' : e?.message || 'Failed';
      loading = false;
      step = 'idle';
      pendingPassword = '';
    }
  }

  function submit(e: Event) {
    e.preventDefault();
    if (!username.trim()) return;
    if (mode === 'register') {
      if (authMethod === 'passkey') handleRegister();
      else handleRegisterPassword();
    } else {
      if (authMethod === 'passkey') handleLogin();
      else handleLoginPassword();
    }
  }
</script>

<svelte:head><title>{mode === 'register' ? 'Create Account' : 'Sign In'} - Food Tracker</title></svelte:head>

<main>
  <div class="login-card" class:register-mode={mode === 'register'}>
    <div class="logo">{mode === 'register' ? '✨' : '🍽️'}</div>
    <h1>Food Tracker</h1>
    {#if mode === 'register'}
      <p class="subtitle">Create your account</p>
    {:else}
      <p class="subtitle">Sign in to your account</p>
    {/if}

    {#if error}
      <div class="error">{error}</div>
    {/if}

    {#if confirmMessage}
      <div class="confirm-msg">{confirmMessage}</div>
    {/if}

    {#if step === 'working'}
      <div class="step-msg">
        <div class="spinner"></div>
        <p>{mode === 'register' ? 'Creating your account...' : 'Waiting for device...'}</p>
        <p class="step-hint">Use Touch ID, Face ID, or your security key</p>
        <button class="cancel" onclick={() => { loading = false; step = 'idle'; error = ''; confirmMessage = ''; pendingPassword = ''; }}>Cancel</button>
      </div>
    {:else}
      <form onsubmit={submit}>
        <input
          bind:value={username}
          placeholder="Username"
          autocomplete="username"
          class="input"
          disabled={loading}
        />

        {#if authMethod === 'passkey'}
          <button type="submit" class="submit passkey-btn" disabled={loading || !username.trim()}>
            {mode === 'register' ? 'Create with Face ID / Touch ID' : 'Sign in with Face ID / Touch ID'}
          </button>

          <div class="divider">or</div>

          <button type="button" class="link-btn" onclick={() => { authMethod = 'password'; error = ''; confirmMessage = ''; }}>
            Click here to use a password instead
          </button>
        {:else}
          <input
            bind:value={password}
            type="password"
            placeholder="Password"
            autocomplete={mode === 'register' ? 'new-password' : 'current-password'}
            class="input"
            disabled={loading}
          />
          {#if mode === 'register'}
            <input
              bind:value={confirmPassword}
              type="password"
              placeholder="Confirm password"
              autocomplete="new-password"
              class="input"
              disabled={loading}
            />
          {/if}

          <button type="submit" class="submit" disabled={loading || !username.trim() || !password.trim()}>
            {mode === 'register' ? 'Create Account' : 'Sign In'}
          </button>

          <div class="divider">or</div>

          <button type="button" class="link-btn" onclick={() => { authMethod = 'passkey'; error = ''; confirmMessage = ''; password = ''; confirmPassword = ''; }}>
            {mode === 'register' ? 'Click here to use Face ID / Touch ID instead' : 'Click here to use Face ID / Touch ID instead'}
          </button>
        {/if}
      </form>

      <button class="toggle" onclick={() => { mode = mode === 'login' ? 'register' : 'login'; error = ''; confirmMessage = ''; password = ''; confirmPassword = ''; }}>
        {mode === 'login' ? "Don't have an account? Register" : 'Already have an account? Sign in'}
      </button>
    {/if}
  </div>
</main>

<style>
  main {
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; min-height: 100dvh; padding: 16px;
    background: linear-gradient(160deg, var(--primary-bg) 0%, var(--bg) 50%, var(--accent-bg) 100%);
  }
  .login-card {
    background: var(--surface-elevated); -webkit-backdrop-filter: blur(24px) saturate(1.8);
    backdrop-filter: blur(24px) saturate(1.8); border: 1px solid var(--border);
    border-radius: var(--radius-xl); padding: 36px 28px; width: 100%; max-width: 340px;
    box-shadow: var(--shadow-lg); text-align: center;
    animation: fade-in 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }
  .logo { font-size: 48px; margin-bottom: 8px; }
  h1 { margin: 0 0 4px; }
  .subtitle { margin: 0 0 24px; color: var(--text-secondary); font-size: 14px; }
  .error { background: var(--danger-bg); border: 1px solid var(--danger-border); color: var(--danger); padding: 10px 12px; border-radius: var(--radius-sm); font-size: 13px; margin-bottom: 12px; }
  .confirm-msg { background: var(--primary-bg); border: 1px solid var(--primary-bg-strong); color: var(--primary-dark); padding: 10px 12px; border-radius: var(--radius-sm); font-size: 13px; margin-bottom: 12px; }
  .input {
    width: 100%; padding: 14px 12px; border: 1px solid var(--border-strong);
    border-radius: var(--radius-md); font-size: 16px; margin-bottom: 12px;
    box-sizing: border-box; text-align: center; background: var(--surface);
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .input:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-bg); }
  .register-mode .input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg); }
  .submit {
    width: 100%; padding: 14px; background: var(--primary); color: #fff;
    border: none; border-radius: var(--radius-md); font-size: 16px; font-weight: 600;
    transition: transform 0.1s, opacity 0.1s, background 0.15s;
  }
  .submit:active { transform: scale(0.97); opacity: 0.85; }
  .register-mode .submit { background: var(--accent); }
  .passkey-btn { background: var(--text-primary); color: var(--bg); }
  .passkey-btn:hover { opacity: 0.85; }
  .register-mode .passkey-btn { background: var(--accent); }
  .register-mode .passkey-btn:hover { background: var(--accent-dark); }
  .submit:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
  .submit:hover:not(:disabled) { opacity: 0.9; }
  .divider { margin: 20px 0; font-size: 13px; color: var(--text-tertiary); position: relative; }
  .divider::before, .divider::after { content: ''; position: absolute; top: 50%; width: 38%; height: 1px; background: var(--border-strong); }
  .divider::before { left: 0; }
  .divider::after { right: 0; }
  .link-btn {
    background: var(--surface); border: 1px solid var(--border-strong);
    color: var(--primary); font-size: 15px; font-weight: 500;
    padding: 14px 16px; border-radius: var(--radius-md); width: 100%;
    box-sizing: border-box; transition: background 0.15s, border-color 0.15s, transform 0.1s;
  }
  .link-btn:active { transform: scale(0.97); }
  .register-mode .link-btn { color: var(--accent); border-color: var(--accent-border); }
  .link-btn:hover { background: var(--muted-bg); border-color: var(--primary); }
  .register-mode .link-btn:hover { border-color: var(--accent); }
  .toggle { background: none; border: none; color: var(--primary); font-size: 13px; cursor: pointer; margin-top: 20px; padding: 0; }
  .register-mode .toggle { color: var(--accent); }
  .toggle:hover { text-decoration: underline; }
  .step-msg { padding: 20px 0; }
  .step-msg p { margin: 8px 0 0; font-size: 15px; }
  .step-hint { color: var(--text-secondary); font-size: 13px !important; }
  .cancel { margin-top: 12px; background: none; border: 1px solid var(--border-strong); color: var(--text-secondary); padding: 8px 16px; border-radius: var(--radius-sm); font-size: 13px; }
  .spinner { width: 32px; height: 32px; border: 3px solid var(--border-strong); border-top-color: var(--primary); border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto; }
  .register-mode .spinner { border-top-color: var(--accent); }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
