use std::{slice, sync::mpsc, thread, time::Duration};

use anyhow::{anyhow, Context};
use windows::{
    core::{implement, Error as WinError, IUnknown, Interface, HRESULT},
    Win32::{
        Media::Audio::{
            eConsole, eRender, ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation,
            IActivateAudioInterfaceCompletionHandler,
            IActivateAudioInterfaceCompletionHandler_Impl, IAudioCaptureClient, IAudioClient,
            IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT,
            AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
            AUDCLNT_STREAMFLAGS_LOOPBACK, AUDIOCLIENT_ACTIVATION_PARAMS,
            AUDIOCLIENT_ACTIVATION_PARAMS_0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
            AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS, PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
            WAVE_FORMAT_PCM,
        },
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize,
            StructuredStorage::{InitPropVariantFromBuffer, PROPVARIANT},
            CLSCTX_ALL, COINIT_MULTITHREADED,
        },
    },
};

const BUFFER_DURATION_100NS: i64 = 1_000_000;
const POLL_INTERVAL: Duration = Duration::from_millis(8);
const PROCESS_ACTIVATION_TIMEOUT: Duration = Duration::from_secs(5);
const PROCESS_SAMPLE_RATE: u32 = 44_100;
const PROCESS_CHANNELS: u16 = 2;
const PROCESS_BITS_PER_SAMPLE: u16 = 16;
const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
const WAVE_FORMAT_EXTENSIBLE: u16 = 65_534;
const KSDATAFORMAT_SUBTYPE_PCM: windows::core::GUID =
    windows::core::GUID::from_u128(0x00000001_0000_0010_8000_00aa00389b71);
const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: windows::core::GUID =
    windows::core::GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);

pub struct LoopbackCapture {
    inner: WasapiLoopbackCapture,
    _com: ComApartment,
}

impl LoopbackCapture {
    pub fn open_system() -> anyhow::Result<Self> {
        let com = ComApartment::init()?;

        let enumerator: IMMDeviceEnumerator =
            unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
                .context("create MMDeviceEnumerator")?;
        let device = unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eConsole) }
            .context("get default render endpoint")?;
        let audio_client: IAudioClient = unsafe { device.Activate(CLSCTX_ALL, None) }
            .context("activate default render IAudioClient")?;
        let mix_format =
            MixFormatPtr::new(unsafe { audio_client.GetMixFormat() }.context("get mix format")?);
        let inner = WasapiLoopbackCapture::start(
            audio_client,
            mix_format.as_ptr(),
            AUDCLNT_STREAMFLAGS_LOOPBACK,
        )
        .context("start system WASAPI loopback")?;

        Ok(Self { inner, _com: com })
    }

    pub fn open_process(pid: u32) -> anyhow::Result<Self> {
        let com = ComApartment::init()?;
        let audio_client = activate_process_loopback_client(pid)
            .with_context(|| format!("activate process loopback for pid {pid}"))?;
        let mut format = process_loopback_format();
        let inner = WasapiLoopbackCapture::start(
            audio_client,
            &mut format,
            AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
        )
        .with_context(|| format!("start process WASAPI loopback for pid {pid}"))?;

        Ok(Self { inner, _com: com })
    }

    pub fn read_available_samples(&self) -> anyhow::Result<Vec<f32>> {
        self.inner.read_available_samples()
    }

    pub fn wait_for_next_poll(&self) {
        thread::sleep(POLL_INTERVAL);
    }

    pub fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }
}

struct WasapiLoopbackCapture {
    audio_client: IAudioClient,
    capture_client: IAudioCaptureClient,
    format: AudioFormat,
}

impl WasapiLoopbackCapture {
    fn start(
        audio_client: IAudioClient,
        wave_format: *mut WAVEFORMATEX,
        stream_flags: u32,
    ) -> anyhow::Result<Self> {
        let format = unsafe { AudioFormat::from_wave_format(wave_format) }?;

        unsafe {
            audio_client.Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                stream_flags,
                BUFFER_DURATION_100NS,
                0,
                wave_format,
                None,
            )
        }
        .context("initialize WASAPI client")?;

        let capture_client: IAudioCaptureClient =
            unsafe { audio_client.GetService() }.context("get capture client")?;
        unsafe { audio_client.Start() }.context("start WASAPI client")?;

        Ok(Self {
            audio_client,
            capture_client,
            format,
        })
    }

    fn read_available_samples(&self) -> anyhow::Result<Vec<f32>> {
        let mut samples = Vec::new();

        loop {
            let packet_size = unsafe { self.capture_client.GetNextPacketSize() }
                .context("get next packet size")?;

            if packet_size == 0 {
                break;
            }

            let mut data = std::ptr::null_mut();
            let mut frame_count = 0;
            let mut flags = 0;

            unsafe {
                self.capture_client
                    .GetBuffer(&mut data, &mut frame_count, &mut flags, None, None)
            }
            .context("get capture buffer")?;

            let read_result = self.read_buffer(data, frame_count, flags, &mut samples);
            let release_result = unsafe { self.capture_client.ReleaseBuffer(frame_count) };

            read_result?;
            release_result.context("release capture buffer")?;
        }

        Ok(samples)
    }

    fn sample_rate(&self) -> u32 {
        self.format.sample_rate
    }

    fn read_buffer(
        &self,
        data: *mut u8,
        frame_count: u32,
        flags: u32,
        samples: &mut Vec<f32>,
    ) -> anyhow::Result<()> {
        if frame_count == 0 {
            return Ok(());
        }

        if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 {
            samples.resize(samples.len() + frame_count as usize, 0.0);
            return Ok(());
        }

        if data.is_null() {
            return Err(anyhow!("capture buffer pointer is null"));
        }

        let byte_len = frame_count as usize * self.format.block_align;
        let bytes = unsafe { slice::from_raw_parts(data, byte_len) };
        self.format
            .decode_mono_frames(bytes, frame_count as usize, samples);
        Ok(())
    }
}

impl Drop for WasapiLoopbackCapture {
    fn drop(&mut self) {
        let _ = unsafe { self.audio_client.Stop() };
    }
}

#[implement(IActivateAudioInterfaceCompletionHandler)]
struct ActivationCompletionHandler {
    sender: mpsc::Sender<windows::core::Result<IAudioClient>>,
}

#[allow(non_snake_case)]
impl IActivateAudioInterfaceCompletionHandler_Impl for ActivationCompletionHandler_Impl {
    fn ActivateCompleted(
        &self,
        activateoperation: windows::core::Ref<'_, IActivateAudioInterfaceAsyncOperation>,
    ) -> windows::core::Result<()> {
        let result = (|| -> windows::core::Result<IAudioClient> {
            let operation = activateoperation.ok()?;
            let mut activate_result = HRESULT(0);
            let mut unknown: Option<IUnknown> = None;
            unsafe { operation.GetActivateResult(&mut activate_result, &mut unknown)? };
            activate_result.ok()?;
            let unknown = unknown.ok_or_else(WinError::empty)?;
            unknown.cast::<IAudioClient>()
        })();

        let _ = self.sender.send(result);
        Ok(())
    }
}

fn activate_process_loopback_client(pid: u32) -> anyhow::Result<IAudioClient> {
    let (sender, receiver) = mpsc::channel();
    let handler: IActivateAudioInterfaceCompletionHandler =
        ActivationCompletionHandler { sender }.into();
    let activation_params = process_loopback_activation_params(pid);
    let prop_variant = process_loopback_prop_variant(&activation_params)?;

    let _operation = unsafe {
        ActivateAudioInterfaceAsync(
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
            &IAudioClient::IID,
            Some(&prop_variant as *const PROPVARIANT),
            &handler,
        )
    }
    .context("call ActivateAudioInterfaceAsync")?;

    receiver
        .recv_timeout(PROCESS_ACTIVATION_TIMEOUT)
        .context("wait for process loopback activation")?
        .context("complete process loopback activation")
}

fn process_loopback_activation_params(pid: u32) -> AUDIOCLIENT_ACTIVATION_PARAMS {
    AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: pid,
                ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
            },
        },
    }
}

fn process_loopback_prop_variant(
    params: &AUDIOCLIENT_ACTIVATION_PARAMS,
) -> windows::core::Result<PROPVARIANT> {
    unsafe {
        InitPropVariantFromBuffer(
            params as *const _ as *const core::ffi::c_void,
            std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
        )
    }
}

fn process_loopback_format() -> WAVEFORMATEX {
    let block_align = PROCESS_CHANNELS * (PROCESS_BITS_PER_SAMPLE / 8);
    WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_PCM as u16,
        nChannels: PROCESS_CHANNELS,
        nSamplesPerSec: PROCESS_SAMPLE_RATE,
        nAvgBytesPerSec: PROCESS_SAMPLE_RATE * block_align as u32,
        nBlockAlign: block_align,
        wBitsPerSample: PROCESS_BITS_PER_SAMPLE,
        cbSize: 0,
    }
}

struct ComApartment;

impl ComApartment {
    fn init() -> anyhow::Result<Self> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok() }
            .context("initialize COM apartment")?;
        Ok(Self)
    }
}

impl Drop for ComApartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

struct MixFormatPtr(*mut WAVEFORMATEX);

impl MixFormatPtr {
    fn new(ptr: *mut WAVEFORMATEX) -> Self {
        Self(ptr)
    }

    fn as_ptr(&self) -> *mut WAVEFORMATEX {
        self.0
    }
}

impl Drop for MixFormatPtr {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CoTaskMemFree(Some(self.0.cast())) };
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct AudioFormat {
    sample_format: SampleFormat,
    sample_rate: u32,
    channels: usize,
    bytes_per_sample: usize,
    block_align: usize,
}

impl AudioFormat {
    unsafe fn from_wave_format(ptr: *const WAVEFORMATEX) -> anyhow::Result<Self> {
        if ptr.is_null() {
            return Err(anyhow!("mix format pointer is null"));
        }

        let format = unsafe { std::ptr::read_unaligned(ptr) };
        let tag = format.wFormatTag;
        let channels = format.nChannels as usize;
        let bits_per_sample = format.wBitsPerSample as usize;
        let block_align = format.nBlockAlign as usize;

        if channels == 0 || bits_per_sample == 0 || block_align == 0 {
            return Err(anyhow!("unsupported empty WASAPI mix format"));
        }

        let sample_format = match tag {
            WAVE_FORMAT_IEEE_FLOAT => SampleFormat::Float32,
            tag if tag == WAVE_FORMAT_PCM as u16 => SampleFormat::Pcm { bits_per_sample },
            WAVE_FORMAT_EXTENSIBLE => unsafe { extensible_sample_format(ptr, bits_per_sample)? },
            _ => return Err(anyhow!("unsupported WASAPI format tag: {}", tag)),
        };

        Ok(Self {
            sample_format,
            sample_rate: format.nSamplesPerSec,
            channels,
            bytes_per_sample: bits_per_sample / 8,
            block_align,
        })
    }

    fn decode_mono_frames(&self, bytes: &[u8], frame_count: usize, out: &mut Vec<f32>) {
        if self.bytes_per_sample == 0 || self.channels == 0 {
            return;
        }

        out.reserve(frame_count);

        for frame_index in 0..frame_count {
            let frame_offset = frame_index * self.block_align;
            let mut sum = 0.0;
            let mut decoded_channels = 0;

            for channel in 0..self.channels {
                let offset = frame_offset + channel * self.bytes_per_sample;
                let end = offset + self.bytes_per_sample;

                if end > bytes.len() {
                    break;
                }

                sum += self.sample_format.decode(&bytes[offset..end]);
                decoded_channels += 1;
            }

            if decoded_channels > 0 {
                out.push((sum / decoded_channels as f32).clamp(-1.0, 1.0));
            }
        }
    }
}

unsafe fn extensible_sample_format(
    ptr: *const WAVEFORMATEX,
    bits_per_sample: usize,
) -> anyhow::Result<SampleFormat> {
    let ext_ptr = ptr.cast::<WAVEFORMATEXTENSIBLE>();
    let sub_format = unsafe { std::ptr::addr_of!((*ext_ptr).SubFormat).read_unaligned() };

    if sub_format == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT {
        Ok(SampleFormat::Float32)
    } else if sub_format == KSDATAFORMAT_SUBTYPE_PCM {
        Ok(SampleFormat::Pcm { bits_per_sample })
    } else {
        Err(anyhow!("unsupported WASAPI extensible sub format"))
    }
}

#[derive(Debug, Clone, Copy)]
enum SampleFormat {
    Float32,
    Pcm { bits_per_sample: usize },
}

impl SampleFormat {
    fn decode(self, bytes: &[u8]) -> f32 {
        match self {
            SampleFormat::Float32 if bytes.len() >= 4 => {
                f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]).clamp(-1.0, 1.0)
            }
            SampleFormat::Pcm { bits_per_sample } => decode_pcm(bytes, bits_per_sample),
            _ => 0.0,
        }
    }
}

fn decode_pcm(bytes: &[u8], bits_per_sample: usize) -> f32 {
    match bits_per_sample {
        8 if !bytes.is_empty() => (bytes[0] as f32 - 128.0) / 128.0,
        16 if bytes.len() >= 2 => i16::from_le_bytes([bytes[0], bytes[1]]) as f32 / i16::MAX as f32,
        24 if bytes.len() >= 3 => decode_i24(bytes) as f32 / 8_388_607.0,
        32 if bytes.len() >= 4 => {
            i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as f32 / i32::MAX as f32
        }
        _ => 0.0,
    }
    .clamp(-1.0, 1.0)
}

fn decode_i24(bytes: &[u8]) -> i32 {
    let raw = ((bytes[2] as i32) << 16) | ((bytes[1] as i32) << 8) | bytes[0] as i32;
    if raw & 0x80_0000 != 0 {
        raw | !0xFF_FFFF
    } else {
        raw
    }
}
