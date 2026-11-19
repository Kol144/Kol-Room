package com.frumos.space;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.OutputStream;
import java.util.UUID;

/** Write a local blob to the document chosen by the musician, one chunk at a time. */
@CapacitorPlugin(name = "DocumentExport")
public class DocumentExportPlugin extends Plugin {
    private OutputStream stream;
    private String session;
    private boolean choosing;

    @PluginMethod
    public synchronized void choose(PluginCall call) {
        if (choosing || stream != null) { call.reject("Ya hay una exportación en curso."); return; }
        choosing = true;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("type", "application/octet-stream"));
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("name", "Frumos"));
        try { startActivityForResult(call, intent, "chosen"); }
        catch (RuntimeException e) { choosing = false; call.reject("No se pudo abrir el selector de archivos.", e); }
    }

    @ActivityCallback
    private synchronized void chosen(PluginCall call, ActivityResult result) {
        choosing = false;
        if (call == null) return;
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) { call.resolve(); return; }
        try {
            stream = getContext().getContentResolver().openOutputStream(uri, "wt");
            if (stream == null) throw new IOException("Destino no disponible");
            session = UUID.randomUUID().toString();
            JSObject reply = new JSObject();
            reply.put("session", session);
            call.resolve(reply);
        } catch (Exception e) { call.reject("No se pudo abrir el destino.", e); }
    }

    private boolean ownsStream(PluginCall call) {
        if (stream != null && session.equals(call.getString("session"))) return true;
        call.reject("La exportación ya está cerrada.");
        return false;
    }

    @PluginMethod
    public synchronized void append(PluginCall call) {
        if (!ownsStream(call)) return;
        try {
            stream.write(Base64.decode(call.getString("data", ""), Base64.DEFAULT));
            call.resolve();
        } catch (Exception e) { call.reject("No se pudo escribir el archivo completo.", e); }
    }

    @PluginMethod
    public synchronized void finish(PluginCall call) {
        if (!ownsStream(call)) return;
        try { stream.close(); call.resolve(); }
        catch (IOException e) { call.reject("No se pudo terminar de guardar.", e); }
        finally { stream = null; session = null; }
    }

    @Override
    protected synchronized void handleOnDestroy() {
        try { if (stream != null) stream.close(); } catch (IOException ignored) {}
        stream = null;
        session = null;
    }
}
