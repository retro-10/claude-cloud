import { publicBaseUrl } from "@/lib/public-url";

export const STATE_COOKIE = "drive_oauth_state";
export const STATE_PATH = "/settings/integrations/drive";
/** Register this exact address as an authorised redirect URI on the Google OAuth client. */
export const callbackUrl = async () => `${await publicBaseUrl()}${STATE_PATH}/callback`;
