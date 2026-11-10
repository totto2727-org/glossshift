//! Discards GPU submission only. Runtime layout, text shaping, DOM, and input remain real.

use zgui::{atlas, bits, geom, render, scene};

struct TextureSink;

impl atlas::TextureSink for TextureSink {
    fn create_texture(
        &mut self,
        _: atlas::TextureId,
        _: geom::Size<i32, geom::Device>,
        _: atlas::TextureFormat,
    ) -> Result<(), atlas::SinkError> {
        Ok(())
    }
    fn write_texture(
        &mut self,
        _: atlas::TextureId,
        _: geom::Rect<i32, geom::Device>,
        _: atlas::TextureFormat,
        _: &[u8],
    ) -> Result<(), atlas::SinkError> {
        Ok(())
    }
    fn destroy_texture(&mut self, _: atlas::TextureId) {}
}

pub(super) struct HeadlessRenderer {
    target: Option<render::RenderTarget>,
    sink: TextureSink,
    next_texture: u64,
}

impl HeadlessRenderer {
    pub(super) fn new(target: render::RenderTarget) -> Self {
        Self {
            target: Some(target),
            sink: TextureSink,
            next_texture: 0,
        }
    }
}

impl render::Renderer for HeadlessRenderer {
    fn capabilities(&self) -> render::RenderCapabilities {
        render::RenderCapabilities::MINIMAL
    }
    fn configure(&mut self, target: render::RenderTarget) {
        self.target = Some(target);
    }
    fn target(&self) -> Option<render::RenderTarget> {
        self.target
    }
    fn draw(&mut self, _: &scene::Scene, _: &bits::DamageSet) -> render::FrameOutcome {
        render::FrameOutcome::Presented(render::FrameStats::default())
    }
    fn register_external(&mut self, _: render::ExternalTexture) -> render::TextureHandle {
        self.next_texture += 1;
        render::TextureHandle(self.next_texture)
    }
    fn release_external(&mut self, _: render::TextureHandle) {}
    fn memory(&self) -> render::MemoryReport {
        render::MemoryReport::ZERO
    }
    fn texture_sink(&mut self) -> &mut dyn atlas::TextureSink {
        &mut self.sink
    }
}
