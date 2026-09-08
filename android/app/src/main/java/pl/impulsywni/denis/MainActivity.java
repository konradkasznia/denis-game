package pl.impulsywni.denis;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VolumePlugin.class); // musi być PRZED super.onCreate
        super.onCreate(savedInstanceState);
    }
}
