package app.selah.mobile

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  // Many phones filter incoming multicast to save power, which hides the
  // desk's mDNS announcement (crates/selah-lan). Held while the app is in
  // front, released when it isn't.
  private var multicastLock: WifiManager.MulticastLock? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    multicastLock = wifi.createMulticastLock("selah-desk-discovery").apply { setReferenceCounted(false) }
  }

  override fun onResume() {
    super.onResume()
    multicastLock?.acquire()
  }

  override fun onPause() {
    multicastLock?.release()
    super.onPause()
  }
}
