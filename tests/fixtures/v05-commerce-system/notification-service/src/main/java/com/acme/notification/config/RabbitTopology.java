package com.acme.notification.config;

import org.springframework.amqp.core.Queue;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RabbitTopology {
    @Bean
    public Queue orderCreatedQueue() {
        return new Queue("order.created", true);
    }
}
