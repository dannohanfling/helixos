package com.evolveomega.helixos;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Offline only when HelixOS truly can't be reached (H-1806, plan H-1813). Set before the first page reports back.
        bridge.setWebViewClient(new HelixWebViewClient(bridge));
    }
}
