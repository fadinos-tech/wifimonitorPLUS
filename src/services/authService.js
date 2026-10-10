import auth from "@react-native-firebase/auth";

// Anonymous Firebase sign-in.
// Purpose: allow the Firestore rules to require `request.auth != null` in a
// future release. The rules still permit unauthenticated writes today so that
// older app versions keep working, so a failure here must never block anything.
export async function ensureSignedIn() {
  try {
    const current = auth().currentUser;
    if (current) return current.uid;

    const cred = await auth().signInAnonymously();
    console.log("Anonymous sign-in OK:", cred.user.uid);
    return cred.user.uid;
  } catch (err) {
    // Most common cause: the Anonymous provider is disabled in the Firebase console.
    console.warn("ensureSignedIn failed:", err?.code, err?.message);
    return null;
  }
}

export function getUid() {
  try {
    return auth().currentUser?.uid || null;
  } catch {
    return null;
  }
}
