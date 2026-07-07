package kr.fees.domain;

import java.util.List;

public record FeeScheduleModel(String id, String name, List<FeeComponent> components) {}
