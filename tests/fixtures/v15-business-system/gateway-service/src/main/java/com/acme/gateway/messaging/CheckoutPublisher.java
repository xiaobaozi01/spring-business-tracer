package com.acme.gateway.messaging;

import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

@Component
public class CheckoutPublisher {
    private final KafkaTemplate<String, String> kafka;
    public CheckoutPublisher(KafkaTemplate<String, String> kafka) { this.kafka = kafka; }
    public void publish(String sku) { kafka.send("checkout.created", sku); }
    public void publishDynamic(String topic, String sku) { kafka.send(topic, sku); }
}
