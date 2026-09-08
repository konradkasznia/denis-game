package pl.impulsywni.denis;

import android.content.Context;
import android.media.AudioManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Mały mostek do głośności multimediów (STREAM_MUSIC).
 *   Volume.get()               -> { level: 0..1, muted: boolean }
 *   Volume.setLevel({ level }) -> { level: 0..1 }   (pokazuje systemowy suwak)
 * Na Androidzie przełącznik ciszy NIE wycisza strumienia multimediów, więc
 * `getStreamVolume(STREAM_MUSIC) == 0` to wiarygodne „telefon wyciszony".
 */
@CapacitorPlugin(name = "Volume")
public class VolumePlugin extends Plugin {

    private AudioManager audio() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    @PluginMethod
    public void get(PluginCall call) {
        AudioManager a = audio();
        JSObject ret = new JSObject();
        if (a == null) {
            ret.put("level", 1.0);
            ret.put("muted", false);
            call.resolve(ret);
            return;
        }
        int max = a.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        int cur = a.getStreamVolume(AudioManager.STREAM_MUSIC);
        ret.put("level", max > 0 ? (double) cur / max : 1.0);
        ret.put("muted", cur == 0);
        call.resolve(ret);
    }

    @PluginMethod
    public void setLevel(PluginCall call) {
        Double raw = call.getDouble("level", 0.5);
        double target = Math.max(0.0, Math.min(1.0, raw == null ? 0.5 : raw));
        AudioManager a = audio();
        JSObject ret = new JSObject();
        if (a == null) {
            ret.put("level", target);
            call.resolve(ret);
            return;
        }
        int max = a.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        int idx = (int) Math.round(target * max);
        try {
            a.setStreamVolume(AudioManager.STREAM_MUSIC, idx, AudioManager.FLAG_SHOW_UI);
        } catch (SecurityException e) {
            // np. tryb „Nie przeszkadzać" — użytkownik musi podkręcić ręcznie
        }
        int now = a.getStreamVolume(AudioManager.STREAM_MUSIC);
        ret.put("level", max > 0 ? (double) now / max : target);
        call.resolve(ret);
    }
}
