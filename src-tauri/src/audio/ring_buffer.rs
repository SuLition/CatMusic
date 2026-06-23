#![allow(dead_code)]

pub struct AudioRingBuffer {
    samples: Vec<f32>,
    write_index: usize,
}

impl AudioRingBuffer {
    pub fn new(capacity: usize) -> Self {
        Self {
            samples: vec![0.0; capacity.max(1)],
            write_index: 0,
        }
    }

    pub fn push(&mut self, sample: f32) {
        self.samples[self.write_index] = sample;
        self.write_index = (self.write_index + 1) % self.samples.len();
    }

    pub fn push_slice(&mut self, samples: &[f32]) {
        for sample in samples {
            self.push(*sample);
        }
    }

    pub fn latest_window(&self, len: usize) -> Vec<f32> {
        if len == 0 {
            return Vec::new();
        }

        let len = len.min(self.samples.len());
        let start = (self.write_index + self.samples.len() - len) % self.samples.len();
        let mut window = Vec::with_capacity(len);
        let first_len = len.min(self.samples.len() - start);

        window.extend_from_slice(&self.samples[start..start + first_len]);

        if first_len < len {
            window.extend_from_slice(&self.samples[..len - first_len]);
        }

        window
    }
}
