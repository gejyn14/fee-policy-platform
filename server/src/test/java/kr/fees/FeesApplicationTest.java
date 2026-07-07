package kr.fees;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class FeesApplicationTest {
    @Test
    void appClassLoads() {
        assertThat(new FeesApplication()).isNotNull();
    }
}
